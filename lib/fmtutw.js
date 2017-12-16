/*
 *  Copyright 2017 weaknespase
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 *
 *  Format library - TEX and FNT codec (Utawarerumono: Itsuwari no Kamen)
 */

var fs = require("fs");
var EventEmitter = require("events");
var co = require("./co");
var u = require("./util");
var ipp = require("./ipp");

var KNOWN_CHUNKS = [
    "Filename",     //Parts of archive format
    "Pack    ",
    "Texture ",     //Parts of texture format
    "Parts   ",
    "Anime   ",
    "Table   "      //Parts of font format
];

class Chunk {
    constructor(name, offset, size) {
        this.name = name;
        this._offset = offset;
        this._size = size;
        this._src = null;
    };
    createReadStream() {
        if (this._src) {
            return fs.createReadStream(this._src, {
                autoClose: true,
                start: this._offset + 12,               //Omit header from data
                end: this._offset + this._size + 11
            });
        } else {
            throw new Error("Unable to read data from metadata only chunk record.");
        }
    }
}

class ChunkFile extends EventEmitter {
    /**
     * Constructs new chunk file instance.
     * @param {string} src path to chunk file
     * @param {string} mode open mode, "r" for reading and "w" for writing
     */
    constructor(src, mode) {
        super();
        this.src = src;
        this.mode = mode;
        this._fd = null;
        this._ptr = 0;
        /** @type {Chunk[]} */
        this._chunks = [];
        switch (mode) {
            case "r":
                co(this.__readFile, this); 
                break;
            case "w":
                fs.open(this.src, "w", (err, fd) => {
                    if (err) {
                        this.emit("error", err);
                    } else {
                        this._fd = fd;
                        this.emit("ready");
                    }
                });
                break;
            default:
                throw new Error("Illegal operation mode: " + mode);    
        }
    };
    getChunk(chunkName) {
        return this._chunks.find(function(v) {
            return v.name == chunkName;
        });
    };
    hasChunk(chunkName) {
        return this._chunks.findIndex(function(v) {
            return v.name == chunkName;
        }) > -1;
    };
    /**
     * @param {string} chunkName name of chunk to write in the output file
     * @param {Buffer|Buffer[]} buffer data source for chunk
     * @param {function(Error, number):void} callback
     */
    write(chunkName, buffer, callback) {
        if (this.mode == "w") {
            if (this._fd != null) {
                var name = u.rpad(chunkName.slice(0, 8), " ", 8);
                var b = Buffer.alloc(12);
                if (Array.isArray(buffer)) {
                    buffer = Buffer.concat(buffer);
                }
                b.write(name, 0, 8, "ascii");
                b.writeUInt32LE(buffer.length + 12, 8);
                fs.write(this._fd, b, 0, b.length, this._ptr, (err) => {
                    if (err) {
                        callback(err);
                    } else {
                        this._ptr += 12;
                        fs.write(this._fd, buffer, 0, buffer.length, this._ptr, callback);
                        this._ptr += buffer.length;
                        this._ptr = u.align(this._ptr, 4);
                    }
                });
            } else {
                callback(new Error("Illegal state - file hasn't been opened successfully."));
            }
        } else {
            callback(new Error("Illegal operation mode, must be in write mode to put new chunk."));
        }
    };
    /**
     * Aligns size of written file to the specific unit size, preparing it for stuffing with out-of-bound data.
     * @param {number} unitSize size of alignment unit.
     * @param {function(Error, number):void} callback
     */
    pad(unitSize, callback) {
        var length = u.align(this._ptr, unitSize) - this._ptr;
        if (length > 0) {
            var b = Buffer.alloc(length, 0);
            fs.write(this._fd, b, 0, b.length, this._ptr, callback);
            this._ptr += length;
        } else callback();    
    }
    /**
     * @param {function(Error):void} callback 
     */
    close(callback) {
        if (this.mode == "w") {
            if (this._fd != null) {
                let fd = this._fd;
                this._fd = null;
                fs.close(fd, callback);
            }
        } else {
            callback(new Error("Illegal operation mode, must be in write mode."));
        }
    }
}
/**
 * @param {ChunkFile} self
 */
ChunkFile.prototype.__readFile = function* (co, self) {
    var complete = false;
    let [err, fd] = yield fs.open(self.src, "r", co);
    if (err) {
        self.emit("error", err);
        return;
    }
    try {
        let input = Buffer.alloc(12);

        let stats;
        [err, stats] = yield fs.fstat(fd, co);
        if (err) {
            self.emit("error", err);
            return;
        }

        let pos = 0;
        while (pos + 12 < stats.size) {
            let [err, ilen] = yield fs.read(fd, input, 0, input.length, pos, co);
            if (err) {
                self.emit("error", err);
                return;
            } else if (ilen < 12) {
                self.emit("error", new Error("IO Error, buffer underrun detected."));
                return;
            }
            let name = input.slice(0, 8).toString("ascii");
            let size = input.readUInt32LE(8);
            if (KNOWN_CHUNKS.indexOf(name) > -1) {
                let chunk = new Chunk(name.trim(), pos, size);
                chunk._src = self.src;
                self._chunks.push(chunk);
                pos += size;
                pos = u.align(pos, 4);
            } else {
                //Invalid chunk found - finish parsing
                break;
            }
        }
        complete = true;
    } finally {
        yield fs.close(fd, co);
        if (complete) self.emit("load");
    }
}

class TextureFile {
    /**
     * @param {TextureChunk} tex 
     * @param {PartsChunk} parts 
     * @param {AnimationChunk} ani 
     */
    constructor(tex, parts, ani) {
        this.image = tex;
        this.parts = parts;
        this.animation = ani;
    };
    /**
     * @param {ChunkFile} [chunkfile]
     * @param {function(Error):void} [callback]
     */
    export(chunkfile, callback) {
        if (chunkfile) {
            var self = this;
            chunkfile.write("Texture", this.image.exportBinary(), function(err) {
                if (err) callback(err);
                else chunkfile.write("Parts", self.parts.exportBinary(), function(err) {
                    if (err) callback(err);
                    else chunkfile.write("Anime", self.animation.exportBinary(), function(err) {
                        if (err) callback(err);
                        else chunkfile.pad(4, callback);
                    });
                });
            });
        } else {
            //Convert object into common export format
            var exp = {
                type: "texture",
                refs: {
                    //TODO Convert image data into one of more recognized formats (PNG for example)
                    image: [this.image.getExtension(), this.image.data]
                },
                image: this.image.export(),
                parts: this.parts.export(this.image.width, this.image.height),
                animation: this.animation.export()
            };
            return exp;
        }    
    };
    static fromChunkFile(chunkfile, callback) {
        co(TextureFile.prototype.__readFile, chunkfile, callback);
    };
    static fromJSObj(obj) {
        if (obj.type == "texture") {
            var t = new TextureChunk(0, 0, 0, null);
            t.import(obj.image, obj.refs.image[1]);
            var p = new PartsChunk();
            p.import(obj.parts, t.width, t.height);
            var a = new AnimationChunk(null);
            a.import(obj.animation);
            return new TextureFile(t, p, a);
        }
    };
    static test(chunkfile) {
        return chunkfile.hasChunk("Texture") && chunkfile.hasChunk("Parts") && chunkfile.hasChunk("Anime");
    }
}
TextureFile.prototype.__readFile = function* (co, chunkfile, callback) {
    var tdata = new u.BufferWriteStream();
    var a = chunkfile.getChunk("Texture");
    if (a) {
        a.createReadStream().pipe(tdata);
        tdata.on("finish", co);
        tdata.on("error", co);
        let [err] = yield;

        if (err) {
            callback(err);
            return;
        }
        tdata = tdata.get();
        if (tdata.length > a._size - 12) tdata = tdata.slice(0, a._size - 12);
    } else {
        callback(new Error("Invalid chunkfile - no Texture chunk."));
        return;
    }

    var pdata = new u.BufferWriteStream();
    var a = chunkfile.getChunk("Parts");
    if (a) {
        a.createReadStream().pipe(pdata);
        pdata.on("finish", co);
        pdata.on("error", co);
        let [err] = yield;

        if (err) {
            callback(err);
            return;
        }
        pdata = pdata.get();
        if (pdata.length > a._size - 12) pdata = pdata.slice(0, a._size - 12);
    } else {
        callback(new Error("Invalid chunkfile - no Parts chunk."));
        return;
    }

    var adata = new u.BufferWriteStream();
    var a = chunkfile.getChunk("Anime");
    if (a) {
        a.createReadStream().pipe(adata);
        adata.on("finish", co);
        adata.on("error", co);
        let [err] = yield;

        if (err) {
            callback(err);
            return;
        }
        adata = adata.get();
        if (adata.length > a._size - 12) adata = adata.slice(0, a._size - 12);
    } else {
        callback(new Error("Invalid chunkfile - no Anime chunk."));
        return;
    }

    //Got everything, parse binary chunks
    callback(null, new TextureFile(
        TextureChunk.fromBinary(tdata),
        PartsChunk.fromBinary(pdata),
        AnimationChunk.fromBinary(adata)
    ));
}

class FontFile {
    /**
     * @param {TableChunk} charmap 
     * @param {TextureChunk} texture 
     */
    constructor (charmap, texture) {
        this.image = texture;
        this.chapmap = charmap;
    };
    /**
     * @param {ChunkFile} [chunkfile]
     * @param {function(Error):void} [callback]
     */
    export(chunkfile, callback) {
        if (chunkfile) {
            var self = this;
            chunkfile.write("Table", this.chapmap.exportBinary(), function(err) {
                if (err) callback(err);
                else chunkfile.write("Texture", self.image.exportBinary(), function(err) {
                    if (err) callback(err);
                    else chunkfile.pad(4, callback);
                });
            });
        } else {
            var exp = {
                type: "font",
                refs: {
                    image: ["bin", this.image.exportData()],
                },
                image: this.image.export(),
                chars: this.chapmap.export(this.image.width, this.image.height)
            }
            return exp;
        }    
    };
    static fromChunkFile(chunkfile, callback) {
        co(FontFile.prototype.__readFile, chunkfile, callback);
    };
    static fromJSObj(obj) {
        if (obj.type == "font") {
            var t = new TextureChunk(0, 0, 0, null);
            t.import(obj.image, obj.refs.image[1]);
            var c = new TableChunk();
            c.import(obj.chars, t.width, t.height);
            return new FontFile(c, t);
        }
    };
    static test(chunkfile) {
        return chunkfile.hasChunk("Table") && chunkfile.hasChunk("Texture");
    }
}
FontFile.prototype.__readFile = function* (co, chunkfile, callback) {
    var cdata = new u.BufferWriteStream();
    var a = chunkfile.getChunk("Table");
    if (a) {
        a.createReadStream().pipe(cdata);
        cdata.on("finish", co);
        cdata.on("error", co);
        let [err] = yield;

        if (err) {
            callback(err);
            return;
        }
        cdata = cdata.get();
        if (cdata.length > a._size - 12) cdata = cdata.slice(0, a._size - 12);
    } else {
        callback(new Error("Invalid chunkfile - no Table chunk."));
        return;
    }

    var tdata = new u.BufferWriteStream();
    var a = chunkfile.getChunk("Texture");
    if (a) {
        a.createReadStream().pipe(tdata);
        tdata.on("finish", co);
        tdata.on("error", co);
        let [err] = yield;

        if (err) {
            callback(err);
            return;
        }
        tdata = tdata.get();
        if (tdata.length > a._size - 12) tdata = tdata.slice(0, a._size - 12);
    } else {
        callback(new Error("Invalid chunkfile - no Texture chunk."));
        return;
    }

    //Got everything, parse binary chunks
    callback(null, new FontFile(
        TableChunk.fromBinary(cdata),
        TextureChunk.fromBinary(tdata)
    ));
}

class TextureChunk {
    /**
     * @param {number} type 
     * @param {number} width 
     * @param {number} height 
     * @param {Buffer} data 
     */
    constructor(type, width, height, data) {
        this.texType = type;
        this.width = width;
        this.height = height;
        this.data = data;
    };
    export() {
        return {
            width: this.width,
            height: this.height,
            type: "0x" + this.texType.toString(16)
        }
    };
    exportData() {
        switch (this.texType) {
            case 0x11000100:
                //Convert 4-bit uncompressed bitmap with palette into PNG
                var p = [];
                for (var i = this.data.length - 64; i < this.data.length; i += 4)
                    p.push(this.data.readUInt32LE(i));
                return ipp.mkPNG({
                    width: this.width,
                    height: this.height,
                    bpp: 4,
                    palette: p,
                    pixels: this.data
                });
            default:
                return this.data;
        }
    };
    import(obj, data) {
        this.texType = parseInt(obj.type);
        this.width = parseInt(obj.width);
        this.height = parseInt(obj.height);
        //FIXME Decode data back
        this.data = data;
    };
    exportBinary() {
        var len = 16;
        var b = Buffer.alloc(len);
        b.writeUInt32LE(this.texType, 0);
        b.writeUInt32LE(this.data.length, 4);
        b.writeUInt32LE(this.width, 8);
        b.writeUInt32LE(this.height, 12);
        return [b, this.data];
    };
    getExtension() {
        switch (this.texType) {
            case 0x81014000:
                return "png";    
            default:
                return "bin";
        }
    };
    static fromBinary(buffer) {
        var type = buffer.readUInt32LE(0);
        var dlen = buffer.readUInt32LE(4);
        var width = buffer.readUInt32LE(8);
        var height = buffer.readUInt32LE(12);
        var data = buffer.slice(16, 16 + dlen);
        return new TextureChunk(type, width, height, data);
    }
}

class PartDescriptor {
    constructor(u1, u2, width, height, ol, ot, ow, oh) {
        this.u1 = u1;
        this.u2 = u2;
        this.width = width;
        this.height = height;
        this.offsetTop = ot;
        this.offsetLeft = ol;
        this.offsetRight = ow;
        this.offsetBottom = oh;
    };
    toString(w, h) {
        return "Part: " + this.width + "x" + this.height + " @ " + Math.round(this.offsetLeft * w) + "x" +
            Math.round(this.offsetTop * h) + "->" + Math.round(this.offsetRight * w) + "x" + Math.round(this.offsetBottom * h);
    }
}

class PartsChunk {
    constructor() {
        /** @type {PartDescriptor[]} */
        this.parts = [];
    };
    export(width, height) {
        var a = [];
        for (var i = 0; i < this.parts.length; i++){
            let part = this.parts[i];
            a.push({
                u0: part.u1,
                u1: part.u2,
                partWidth: part.width,
                partHeight: part.height,
                offsetLeft: u.round(part.offsetLeft * width, .1),
                offsetTop: u.round(part.offsetTop * height, .1),
                offsetRight: u.round(part.offsetRight * width, .1),
                offsetBottom: u.round(part.offsetBottom * height, .1)
            });
        }
        return a;
    };
    import(obj, width, height) {
        for (var i = 0; i < obj.length; i++){
            this.parts.push(new PartDescriptor(
                obj[i].u0,
                obj[i].u1,
                obj[i].partWidth,
                obj[i].partHeight,
                obj[i].offsetLeft / width,
                obj[i].offsetTop / height,
                obj[i].offsetRight / width,
                obj[i].offsetBottom / height
            ));
        }
    };
    exportBinary() {
        var len = 4 + this.parts.length*32;
        var b = Buffer.alloc(len);
        b.writeUInt32LE(this.parts.length, 0);
        var offset = 4;
        for (var i = 0; i < this.parts.length; i++){
            let part = this.parts[i];
            b.writeUInt32LE(part.u1, offset);
            b.writeUInt32LE(part.u2, offset + 4);
            b.writeFloatLE(part.width, offset + 8);
            b.writeFloatLE(part.height, offset + 12);
            b.writeFloatLE(part.offsetLeft, offset + 16);
            b.writeFloatLE(part.offsetTop, offset + 20);
            b.writeFloatLE(part.offsetRight, offset + 24);
            b.writeFloatLE(part.offsetBottom, offset + 28);
            offset += 32;
        }
        return b;
    };
    static fromBinary(buffer) {
        var p = new PartsChunk();
        var offset = 0;
        let count = buffer.readUInt32LE(offset);
        offset += 4;
        if (count * 32 + 4 > buffer.length)
            throw new Error("Insufficient data in buffer for parts chunk.");
        while (count > 0) {
            p.parts.push(new PartDescriptor(
                buffer.readUInt32LE(offset),
                buffer.readUInt32LE(offset + 4),
                buffer.readFloatLE(offset + 8),
                buffer.readFloatLE(offset + 12),
                buffer.readFloatLE(offset + 16),
                buffer.readFloatLE(offset + 20),
                buffer.readFloatLE(offset + 24),
                buffer.readFloatLE(offset + 28)
            ));
            offset += 32;
            count--;
        }
        return p;
    }
}

class AnimationChunk {
    constructor(data) {
        this.data = data;
    };
    export() {
        return this.data.toString("hex");
    };
    import(obj) {
        this.data = Buffer.from(obj, "hex");
    };
    exportBinary() {
        return this.data;
    };
    static fromBinary(buffer) {
        return new AnimationChunk(buffer);
    }
}

class FontCell {
    /** @param {number} char */
    constructor(char, x, y) {
        this.charCode = char;
        this.char = "";
        if (char < 0xD800 || char > 0xDFFF) {
            if (char <= 0xffff) {
                this.char = String.fromCharCode(char);
            } else {
                this.char = String.fromCharCode(((char >> 10) & 0x3ff) + 0xd800) + String.fromCharCode((char & 0x3ff) + 0xdc00);
            }
        }
        this.x = x;
        this.y = y;
    };
    static fromUTF8(num) {
        if (num & 0xff000000) {
            return ((num & 0x7000000) >> 6) | ((num & 0x3f0000) >> 4) | ((num & 0x3f00) >> 2) | (num & 0x3f);
        } else if (num & 0xff0000) {
            return ((num & 0xf0000) >> 4) | ((num & 0x3f00) >> 2) | (num & 0x3f);
        } else if (num & 0xff00) {
            return ((num & 0x1f00) >> 2) | (num & 0x3f);
        } else if (num & 0xff) {
            return num
        }
        return 0;
    };
    static toUTF8(num) {
        if (num >= 0x10000) {
            return ((0xf0 | (num >> 18)) << 24) | ((0x80 | (num >> 12 & 0x3f)) << 16) | ((0x80 | (num >> 6 & 0x3f)) << 8) | (0x80 | (num & 0x3f));
        } else if (num >= 0x800) {
            return ((0xe0 | (num >> 12)) << 16) | ((0x80 | (num >> 6 & 0x3f)) << 8) | (0x80 | (num & 0x3f));
        } else if (num >= 0x80) {
            return ((0xc0 | (num >> 6)) << 8) | ((0x80 | (num & 0x3f)));
        } else {
            return num;
        }
    }
}

class TableChunk {
    constructor() {
        this.cellSize = 0;
        this.cellCount = 0;
        /** @type {FontCell[]} */
        this.cells = [];
    };
    export(width, height) {
        return {
            cellSize: this.cellSize,
            cellCount: this.cellCount,
            cells: this.cells.map(function(v) {
                return {
                    char: v.char,
                    code: v.charCode,
                    x: u.round(v.x * width, .1),
                    y: u.round(v.y * height, .1)
                };
            })
        }
    };
    import(obj, width, height) {
        this.cellSize = obj.cellSize;
        this.cellCount = obj.cellCount;
        for (var i = 0; i < obj.cells.length; i++){
            this.cells.push(new FontCell(obj.cells[i].code, obj.cells[i].x / width, obj.cells[i].y / height));
        }
    };
    exportBinary() {
        var len = 8 + this.cells.length * 12;
        this.cellCount = this.cells.length;
        var b = Buffer.alloc(len);
        b.writeUInt32LE(this.cellSize, 0);
        b.writeUInt32LE(this.cellCount, 4);
        var offset = 8;
        for (var i = 0; i < this.cells.length; i++) {
            b.writeUInt32LE(FontCell.toUTF8(this.cells[i].charCode), offset);
            b.writeFloatLE(this.cells[i].x, offset + 4);
            b.writeFloatLE(this.cells[i].y, offset + 8);
            offset += 12;
        }
        return b;
    };
    static fromBinary(buffer) {
        var t = new TableChunk();
        var offset = 0;
        t.cellSize = buffer.readUInt32LE(offset);
        t.cellCount = buffer.readUInt32LE(offset + 4);
        offset += 8;
        if (t.cellCount * 12 + 8 > buffer.length) 
            throw new Error("Insufficient data in buffer for table chunk.");
        var count = t.cellCount;
        while (count > 0) {
            t.cells.push(new FontCell(FontCell.fromUTF8(buffer.readUInt32LE(offset)), buffer.readFloatLE(offset + 4), buffer.readFloatLE(offset + 8)));
            offset += 12;
            count--;
        }
        return t;
    }
}

module.exports.ChunkFile = ChunkFile;
module.exports.TextureFile = TextureFile;
module.exports.FontFile = FontFile;