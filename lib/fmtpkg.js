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
 *  Format library - PKG archive (Tokyo Xanadu) (Also applicable to the Sen no Kiseki)
 */

var fs = require("fs");
var EventEmitter = require("events");
var co = require("./co");
var lzc = require("./lzc");
var u = require("./util");

class FileRecord{
    constructor(name, offset, size, csize, flags, src) {
        this.name = name;
        this._offset = offset;
        this._size = size;
        this._csize = csize;
        this._flags = flags;
        this._src = src;
    }
    createReadStream() {
        if (this._src) {
            let offset = 0;
            if (this._flags & this.FLAG_COMPRESSED) offset += 8;
            if (this._flags & this.FLAG_LOCAL_HDR) offset += 4;
            var stream = fs.createReadStream(this._src, {
                autoClose: true,
                start: this._offset + offset,
                end: this._offset + this._csize - 1
            });
            if (this._flags & this.FLAG_COMPRESSED) {
                var u = new lzc.ExpandStream();
                stream = stream.pipe(u);
            }
            return stream;
        } else {
            throw new Error("File record is metadata only.");
        }
    };
    /** @param {Buffer} buffer */
    _writeHeader(buffer, offset) {
        buffer.fill(0, offset, offset + 80);
        buffer.write(this.name, offset, 64, "utf8");
        buffer.writeUInt32LE(this._size, offset + 64);
        buffer.writeUInt32LE(this._csize, offset + 68);
        buffer.writeUInt32LE(this._offset, offset + 72);
        buffer.writeUInt32LE(this._flags, offset + 76);
    }
}
FileRecord.prototype.FLAG_COMPRESSED = 0x1;
FileRecord.prototype.FLAG_LOCAL_HDR = 0x2;

class Package extends EventEmitter {
    /**
     * @param {string} src path to file
     * @param {string} flags operation type, "r" for reading package, "w" for writing
     */
    constructor(src, flags) {
        super();
        this.src = src;
        this.mode = flags;
        /** @type {FileRecord[]} */
        this.files = [];
        this._fd = -1;
        this._hdrsize = 0;
        this._dataOffset = 0;
        this._init = false;
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
    writeHeader(records, callback) {
        if (this._init) {
            throw new Error("Package header was already initialized.");
        }
        this._hdrsize = records.length * 80 + 8;
        this._hdrOffset = 8;
        this._dataOffset = this._hdrsize;
        this._init = true;

        let b = Buffer.alloc(8);
        b.writeUInt32LE(0, 0);
        b.writeUInt32LE(records.length, 4);
        fs.write(this._fd, b, 0, b.length, 0, callback);
    };
    writeFile(name, compress, stream, callback) {
        co(writefile, this, name, compress, stream, callback);
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

function* writefile(co, pkg, name, compress, stream, callback) {
    var rec = new FileRecord(name, -1, -1, -1, 0, null);
    var offset = 0;
    if (compress) {
        rec._flags |= FileRecord.prototype.FLAG_COMPRESSED;
        if (typeof compress.mark == "number") {
            stream = stream.pipe(new lzc.CompressStream(compress.mark));
        } else {
            callback(new Error("Invalid compression options."));
            return;
        }
        offset += 8;
    }
    var out = fs.createWriteStream(pkg.src, {
        start: pkg._dataOffset + offset,
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
    rec._csize = rec._size = out.bytesWritten;
    let b = Buffer.alloc(80);
    if (compress) {
        rec._size = stream.inputBytes;
        rec._csize += 8;
        b.writeUInt32LE(rec._size, 0);
        b.writeUInt32LE(rec._csize, 4);
        let [err] = yield fs.write(pkg._fd, b, 0, 8, pkg._dataOffset, co);
        if (err) {
            callback(err);
            return;
        }
    }
    pkg._dataOffset += rec._csize;
    rec._writeHeader(b, 0);
    [err] = yield fs.write(pkg._fd, b, 0, b.length, pkg._hdrOffset, co);
    pkg._hdrOffset += 80;
    callback(err);
}

/** @param {Package} pkg */
function* readpkg(co, pkg) {
    let [err, fd] = yield fs.open(pkg.src, "r", co);
    if (err) {
        pkg.emit("error", err);
        return;
    }
    try {
        let input = Buffer.alloc(16384);
        let iptr = 0;

        let [err, ilen] = yield fs.read(fd, input, 0, input.length, 0, co);
        if (err) {
            pkg.emit("error", err); 
            return;
        }
        let pos = ilen;

        let stats;
        [err, stats] = yield fs.stat(pkg.src, co);
        if (err) {
            pkg.emit("error", err);
            return;
        }
        
        //No magic test - first four bytes belong to patch counter
        //let magic;
        //if ((magic = input.readUInt32LE(0)) == 0x0) {
        if (true) {
            let records = input.readUInt32LE(4);
            iptr = 8;
            if (stats.size < records * 80 + 8) {
                pkg.emit("error", new Error("File incomplete, expected header size " + (records * 80 + 8) + " bytes, got " + stats.size + " bytes."));
                return;
            }
            pkg._hdrsize = 8 + 80 * records;
            while (records > 0) {
                if (ilen - iptr < 80) {
                    input.copy(input, 0, iptr, ilen);
                    let [err, readBytes] = yield fs.read(fd, input, ilen - iptr, input.length - ilen + iptr, pos, co);
                    if (err) {
                        pkg.emit("error", err);
                        return;
                    } else if (readBytes == 0) {
                        pkg.emit("error", new Error("Unexpected end of file."));
                        return;
                    }
                    ilen = ilen - iptr + readBytes;
                    pos += readBytes;
                    iptr = 0;
                } else {
                    let name = input.slice(iptr, iptr + 64).toString("utf8");
                    if (name.indexOf("\x00") > -1) name = name.substr(0, name.indexOf("\x00"));
                    let size = input.readUInt32LE(iptr + 64);
                    let csize = input.readUInt32LE(iptr + 68);
                    let offset = input.readUInt32LE(iptr + 72);
                    let flags = input.readUInt32LE(iptr + 76);
                    pkg.files.push(new FileRecord(name, offset, size, csize, flags, pkg.src));
                     records--;
                    iptr += 80;
                }
            }
            pkg._init = true;
            var complete = true;
        }/* else {
            pkg.emit("error", new Error("Not a pkg file, magic is 0x" + u.lpad(magic.toString(16), "0", 8)) + ", expected 0x00000000.");
            return;
        }*/
    } catch (err) {
        pkg.emit("error", err);
    } finally {
        yield fs.close(fd, co);
        if (complete) pkg.emit("load");
    }
}

module.exports.Package = Package;


/*
    Package files format is pretty straightforward, it's just a header followed by files data.
    All multibyte values are in Little Endian format (least sighnificant byte first, aka Intel order)
    and no variable length bitfields are used.

    File format:
        u32                         magic_bytes?        always set to 0x0
        u32                         files_count         number of files stored
        file_rec[files_count]       file_entry          index table
        u8[]                        file_data[0]
        ...                         ...
        u8[]                        file_data[files_count-1]

    file_rec structure looks following:
        char[64]        name
        u32             uncompressed_size
        u32             compressed_size
        u32             data_offset
        u32             flags

    flags is a bitfield with two known flags currently:
        FLAG_COMPRESSED     0x1     Means that file data is actually compressed by custom implementation of lz77.
        FLAG_LOCAL_HDR      0x2     Means that file data prepended by 4-byte hash sum.

    Compression scheme:
        Compression method is a simple flavour of lz77 (it's a very famous algorythm to repeat it here again)
        with sliding window size of 254 bytes.

        Compression data layout:

            u32     uncompressed_size
            u32     compressed_size
            u8      marker_byte
            u8[3]   reserved

        Reference marker format:
            u8      marker_byte
            u8      offset
            u8      length
*/