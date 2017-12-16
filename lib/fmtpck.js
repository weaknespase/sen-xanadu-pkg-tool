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
 *  Format library - PCK(SDAT) archive (Utawarerumono: Itsuwari no Kamen)
 */

var fs = require("fs");
var co = require("./co");
var EventEmitter = require("events");
var u = require("./util");

const DATA_ALIGN = 0x800;

class FileRecord {
    constructor(name, offset, size, src) {
        this.name = name;
        this._offset = offset;
        this._size = size;
        this._src = src;
    };
    createReadStream() {
        if (this._src) {
            var stream = fs.createReadStream(this._src, {
                autoClose: true,
                start: this._offset,
                end: this._offset + this._size - 1
            });
            return stream;
        } else {
            throw new Error("File record is metadata only.");
        }
    }
    /**
     * @param {Buffer} buffer 
     * @param {number} offset 
     */
    _writeHeader(buffer, offset) {
        buffer.writeUInt32LE(this._offset, offset);
        buffer.writeUInt32LE(this._size, offset + 4);
        return offset + 8;
    }
}

class Package extends EventEmitter {
    /**
     * @param {string} src path to file
     * @param {string} flags operation mode, 'r' for reading, 'w' for writing (creating)
     */
    constructor(src, flags) {
        super();
        this.src = src;
        this.mode = flags;
        /** @type {FileRecord[]} */
        this.files = [];
        this._fd = null;
        this._init = false;
        this._hdrsize = 0;
        this._hdrOffset = 0;
        switch (flags) {
            case "r":
                co(readpkg, this); 
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
                throw new Error("Illegal operation mode: " + flags);    
        }
    };
    /**
     * @param {string[]} records 
     * @param {function(Error)} callback 
     */
    writeHeader(records, callback) {
        if (this._init) {
            throw new Error("Package header was already initialized.");
        }
        //Filename chunk
        this._hdrsize = 12;
        for (var i = 0; i < records.length; i++){
            this._hdrsize += Buffer.byteLength(records[i], "utf8") + 5;
        }
        //Write filename chunk
        var fnameChunkSize = this._hdrsize;
        this._hdrsize = align(this._hdrsize, 4);
        var packChunkOffset = this._hdrsize;
        //Pack chunk
        this._hdrOffset = this._hdrsize + 16;
        this._hdrsize = this._hdrOffset + (records.length * 8);
        //Align to 16 bytes
        if (DATA_ALIGN)
            this._hdrsize = align(this._hdrsize, DATA_ALIGN);

        this._dataOffset = this._hdrsize;
        this._init = true;
        
        let buf = Buffer.alloc(this._hdrsize);
        buf.write("Filename", 0, 8, "ascii");
        buf.writeUInt32LE(fnameChunkSize, 8);
        let ptr = 12;
        let nameptr = 12 + records.length * 4;
        for (var i = 0; i < records.length; i++){
            buf.writeUInt32LE(nameptr - 12, ptr);
            ptr += 4;
            nameptr += buf.write(records[i], nameptr, buf.length, "utf8");
            buf[nameptr++] = 0;
        }

        buf.write("Pack    ", packChunkOffset, 8, "ascii");
        buf.writeUInt32LE(16 + records.length * 8, packChunkOffset + 8);
        buf.writeUInt32LE(records.length, packChunkOffset + 12);

        fs.write(this._fd, buf, 0, buf.length, 0, callback);
    };
    writeFile(name,  stream, callback) {
        co(writefile, this, name, stream, callback);
    };
    getFileCompressParams(stream, callback) {
        var as = new lzc.AnalyzeStream();
        as.on("error", callback);
        as.on("finish", function() {
            callback(null, {
                mark: as.leastFrequentByte
            });
        });
        stream.pipe(as);
    };
    close(callback) {
        fs.close(this._fd, callback);
    }
}

/**
 * @param {Package} pkg 
 */
function* readpkg(co, pkg) {
    var complete = false;
    let [err, fd] = yield fs.open(pkg.src, "r", co);
    if (err) {
        pkg.emit("error", err);
        return;
    }
    try {
        let input = Buffer.alloc(0x40000);
        let iptr = 0;

        let [err, ilen] = yield fs.read(fd, input, 0, input.length, 0, co);
        if (err) {
            pkg.emit("error", err);
            return;
        }
        let pos = 0;

        let stats;
        [err, stats] = yield fs.stat(pkg.src, co);
        if (err) {
            pkg.emit("error", err);
            return;
        }
        
        let magic = input.slice(0, 8).toString("ascii");
        if (magic == "Filename") {
            let length = input.readUInt32LE(8);
            iptr = 12;
            if (stats.size < length) {
                pkg.emit("error", new Error("File incomplete, chunk extends past EOF."));
                return;
            }
            let indices = [input.readUInt32LE(iptr) + 12];
            let names = [];
            let index = 0;
            let loadnext = false, indexMode = true;
            iptr += 4;
            while (pos + iptr < length) {
                if (loadnext) {
                    pos += iptr;
                    console.log("Last read at " + pos + " eadr " + (pos + input.length));
                    let [err, ilen] = yield fs.read(fd, input, 0, input.length, pos, co);
                    if (err) {
                        pkg.emit("error", err);
                        return;
                    } else if (ilen == 0) {
                        pkg.emit("error", new Error("Unexpected end of file."));
                        return;
                    }
                    iptr = 0;
                    loadnext = false;
                } else if (indexMode) {
                    if (pos + iptr >= indices[0]) {
                        indexMode = false;
                    } else {
                        if (ilen - iptr < 4) {
                            loadnext = true;
                        } else {
                            indices.push(input.readUInt32LE(iptr) + 12);
                            iptr += 4;
                        }
                    }
                } else {
                     let start = indices[index];
                    let end = indices[index + 1];
                    if (isNaN(end)) end = length;
                    start -= pos;
                    end -= pos;
                    if (end > ilen) {
                        loadnext = true;
                    } else {
                        names.push(u.readCSTR(input, start, end));
                        iptr = end;
                        index++;
                    }
                }
            }

            //Align next entry to 4-byte boundary
            iptr = align(iptr + pos, 4) - pos;
            if (ilen - iptr < 16) {
                pos += iptr;
                let [err, ilen] = yield fs.read(fd, input, 0, input.length, pos, co);
                if (err) {
                    pkg.emit("error", err);
                    return;
                } else if (ilen == 0) {
                    pkg.emit("error", new Error("Unexpected end of file."));
                    return;
                }
                iptr = 0;
            }
            magic = input.slice(iptr, iptr + 8).toString("ascii");
            console.log(magic + " at " + (iptr + pos));
            if (magic == "Pack    ") {
                length = input.readUInt32LE(iptr + 8);
                iptr += 12;
                let num_files = input.readUInt32LE(iptr);
                iptr += 4;
                for (var i = 0; i < num_files; i++){
                    if (ilen - iptr < 8) {
                        pos += iptr;
                        let [err, ilen] = yield fs.read(fd, input, 0, input.length, pos, co);
                        if (err) {
                            pkg.emit("error", err);
                            return;
                        } else if (ilen == 0) {
                            pkg.emit("error", new Error("Unexpected end of file."));
                            return;
                        }
                        iptr = 0;
                    } else {
                        let offset = input.readUInt32LE(iptr);
                        let size = input.readUInt32LE(iptr + 4);
                        pkg.files.push(new FileRecord(names[i], offset, size, pkg.src));
                        iptr += 8;
                    }
                }
            } else {
                pkg.emit("error", new Error("Not a valid package file, next chunk must have 'Pack' type."));
                return;
            }
            
            complete = true;
        } else {
            pkg.emit("error", new Error("Not a valid package file, first chunk must have 'Filename' type."));
            return;
        }
    } catch (err) {
        pkg.emit("error", err);
    } finally {
        yield fs.close(fd, co);
        if (complete) pkg.emit("load");
    }
}

function* writefile(co, pkg, name, stream, callback) {
    var rec = new FileRecord(name, -1, -1, null);

    var out = fs.createWriteStream(pkg.src, {
        start: pkg._dataOffset,
        flags: "r+"
    });
    stream.pipe(out);
    out.on("error", co);
    out.on("finish", co);
    var [err] = yield;
    if (err) {
        callback(err);
        return;
    }
    rec._offset = pkg._dataOffset;
    rec._size = out.bytesWritten;
    pkg._dataOffset += rec._size;
    if (DATA_ALIGN) {
        let pad = align(pkg._dataOffset, DATA_ALIGN) - pkg._dataOffset;
        if (pad > 0) {
            yield fs.write(pkg._fd, Buffer.alloc(pad, 0x0), 0, pad, pkg._dataOffset, co);
            pkg._dataOffset += pad;
        }
    }
    
    var b = Buffer.alloc(8);
    rec._writeHeader(b, 0);
    [err] = yield fs.write(pkg._fd, b, 0, b.length, pkg._hdrOffset, co);
    pkg._hdrOffset += 8;
    callback(err);
}

/**
 * @param {number} num 
 * @param {number} alignment 
 */
function align(num, alignment) {
    return num + ((alignment - (num % alignment)) % alignment);
}

module.exports.Package = Package;

/**
 * In the best traditions of genre, files represent series of chunks.
 * Each chunk gets a header, which describes type of chunk and its length.
 * Optionally, chunk header can include additional information about its data.
 * All chunks appear to be 4 bytes aligned.
 *
 * Known file formats:
 *  Packfile (PKC, SDAT):
 *      Filename chunk
 *      Pack chunk
 *  Texture (TEX):
 *      Texture chunk
 *  FontFile (FNT):
 *      Table chunk
 *      Texture chunk
 */

/*
    Filename chunk:
        char[8]     "Filename"
        uint32      chunk_length
        uint32[]    name_offset
        char[][]    names

    chunk_length includes header,
    name_offset relative to chunk data, which starts after chunk_length field and runs to
    names is an array of zero-terminated strings
*/

/*
    Pack chunk:
        char[8]                 "Pack    "
        uint32                  chunk_length
        uint32                  num_files
        descriptor[num_files]   descriptors

    descriptor:
        uint32      offset
        uint32      length

    offset in descriptor relative to file start in which chunk appears
    File data appear to be aligned to 16 bytes

*/

/*
    Font-def (Table) chunk:
        char[8]                 "Table   "
        uint32                  chunk_length
        uint32                  cell_size
        uint32                  num_cells
        cell_data[num_cells]    cells

    cell_data:
        uint32                  charCode
        float                   s
        float                   t

    charCode actually utf8 encoded little endian dword, not a pure Unicode codepoint.
    s and t are offsets into texture attached to font file, specifying upper left corner of character image.
*/

/*
    Texture chunk:
        char[8]             "Texture "
        uint32              chunk_length
        uint32              unk_1
        uint32              data_length
        uint32              image_width
        uint32              image_height
        byte[data_length]   data
    
    LZ77 8-bit RGBA8 pallette:  0x21040200
    4-bit RGBA8 palette:        0x11000100
    LZ77 DXTn(3/5):             0x11041000
    PNG:                        0x81014000

    //First byte probably designates pixel format
    //Second byte probably encoding type
    //Third byte ??
    //Forth byte unused?

*/

/*
    Parts chunk: (Part of texture file)
        char[8]                 "Parts   "
        uint32                  chunk_length
        uint32                  num_parts
        part_data[num_parts]    parts

    part_data:  size 0x20
        uint32
        uint32
        float           width
        float           height
        float           offset_left
        float           offset_top
        float           offset_width
        float           offset_height


*/