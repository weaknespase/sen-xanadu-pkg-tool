/*
 * Short and simple tool that could be used to extract/create PKG archives used in Tokyo Xanadu (PSVita version)
 * Usage:
 *  node pkg_tool.js unpack [-o directory] [--] input
 *  node pkg_tool.js pack [-fccv] [-o file.pkg] [--] file1 file2 ... fileN
 *
 *  All flags can be combined (*nix fashion)
 *  Verbs:
 *    unpack        extracts all files from package to specified directory. If multiple packages specified
 *                  files from each package end up in package subfolder.
 *    pack          packs all specified files into a package. If directory specified all files from this
 *                  directory (but not from subdirectories) will be also placed inside archive. (Beware of
 *                  files with same names)
 *  Flags:
 *    -f            Overwrite output file in pack mode. 
 *    -c            Compress files. If repeated, compression is more thourough but slower. If repeated twice, mixed mode enabled.
 *                      fast - finish search at first match
 *                      full - always search for best match, should be default for release packages
 *                      full+mixed - check compressed size and pack uncompressed data if it is smaller
 *    -o            Specify output file (pack mode) or directory (unpack mode). By default current directory is used.
 *    -v            Show progress.
 *    --            Disables flag parsing. Use if input files or directories start with '-' to prevent confusion with flags.
 */

var fs = require("fs");
var path = require("path");
var stream = require("stream");

//Integrated coroutine library for portability
var co = function() {
    function Coroutine() {
        this.queue = [];
        this.current = null;
        this.scheduled = false;
    }
    Coroutine.prototype.run = function coRun(generator, ...args) {
        this.queue.push([generator, args]);
        if (!this.current && !this.scheduled) {
            process.nextTick(this.__run.bind(this));
            this.scheduled = true;
        }
        return this;
    }
    Coroutine.prototype.__run = function coRunInternal() {
        this.scheduled = false;
        this.current = this.queue.shift();
        if (this.current) {
            this.current[1].unshift(this.__callback.bind(this));
            this.current = this.current[0].apply(null, this.current[1]);
            let m = this.current.next();
            if (m.done) {
                process.nextTick(this.__run.bind(this));
            }
        }
    }
    Coroutine.prototype.__callback = function coCallback(...args) {
        var result = this.current.next(args);
        if (result.done) {
            process.nextTick(this.__run.bind(this));
        }
    }

    /**
     * Creates new coroutine based on specified generator.
     * @param {function:{next:function}} generator coroutine code
     * @param {any} ...args arguments to pass at generator creation
     */
    return function co(generator, ...args) {
        var co = new Coroutine();
        co.run(generator, ...args);
        return co;
    }
}();

const MODE_HELP = "help";
const MODE_UNPACK = "unpack";
const MODE_PACK = "pack";

var mode = MODE_HELP;
var out = process.cwd();
var overwrite = false;
var compress = 0;
var verbose = false;
var input = [];
{
    //Read arguments
    console.error("PKG_tool - Archive tool for working with PKG files from Tokyo Xanadu assets.");
    if (process.argv.length > 2) {
        mode = process.argv[2];
        if (process.argv.length > 3) {
            let start = 3;
            let markerMet = false;
            while (process.argv.length > start && process.argv[start][0] == "-" && !markerMet) {
                let name = process.argv[start++].substr(1);
                for (var i = 0; i < name.length; i++){
                    switch (name[i]) {
                        case "f":
                            overwrite = true;
                            break;
                        case "c":
                            compress++;
                            break;
                        case "o":
                            if (process.argv[start])
                                out = process.argv[start++];
                            else {
                                console.error("Output " + (mode == MODE_PACK ? "file" : "directory") + " must be specified after -o flag.");
                                process.exit(1);
                            }
                            break;
                        case "v":
                            verbose = true;
                            break;    
                        case "-":
                            markerMet = true;    
                            break;    
                        default:
                            console.error("Unknown argument: " + name);
                            process.exit(1);
                            break;
                    }
                }
            }
            for (let i = start; i < process.argv.length; i++){
                input.push(process.argv[i]);
            }
        } else {
            console.error("Insufficient number of arguments.");
            mode = MODE_HELP;
        }
    }
}

{
    //Check mode and run program
    switch (mode) {
        case MODE_HELP: {
            console.error("Usage:\n\tnode pkg_tool.js unpack [-v] [-o directory] [--] input");
            console.error("\tnode pkg_tool.js pack [-fccv] [-o file] [--] file1 file2 ... fileN\nSee source code for more info.");
            process.exit(1);
        }
        case MODE_UNPACK: {
            co(prepareOutput)
                .run(extractMode);
            break;
        }
        case MODE_PACK: {
            co(prepareOutput)
                .run(packMode);
            break;
        }
        default:
            console.error("Unknown operation '" + mode + "'.");
            process.exit(1);
    }
}

function* mkdirs(co, dir) {
    var [err] = yield fs.mkdir(dir, co);
    if (err) {
        if (err.code == "EEXIST") {
            return;
        } else if (err.code == "ENOENT") {
            yield* mkdirs(co, path.dirname(dir));
            var [err] = yield fs.mkdir(dir, co);
            return err;
        }
    }
}

function* prepareOutput(co) {
    var err = yield* mkdirs(co, (mode == MODE_PACK ? path.dirname(out) : out));
    if (err) {
        console.error("Can't create output directory.");
        process.exit(2);
    }
    var [err, stat] = yield fs.stat(out, co);
    if (err) {
        if (mode == MODE_UNPACK) {
            //Extraction directory is not here, stop
            console.error("Output directory is not found.");
            process.exit(2);
        }    
    } else {
        if (mode == MODE_UNPACK && !stat.isDirectory()) {
            console.error("Invalid output specified.");
            process.exit(3);
        } else if (mode == MODE_PACK) {
            if (stat.isDirectory()) {
                console.error("Target is directory.");
                process.exit(2);
            } else {
                //Stop here to prevent file overwriting
                if (!overwrite) {
                    console.error("Target file already exists, use different name or specify --overwrite to replace exiting file.");
                    process.exit(2);
                }
            }    
        }
    }
}

function* extractMode(co) {
    var multimode = input.length > 1;
    while (input.length > 0) {
        var file = input.shift();
        var package = new Package();
        var [err] = yield package.open(file, co);
        if (err) {
            if (err.code == "ENOENT") {
                console.error("File not found: " + file + ".");
            } else if (err.code == "EBUSY") {
                console.error("File '" + file + "' is opened by another process.");
            } else {
                console.error("Invalid PKG file: " + file);
            }
        } else {
            let dir = out;
            if (multimode) {
                dir = path.basename(file);
                if (dir.lastIndexOf(".")>-1) dir = dir.substr(0, dir.lastIndexOf("."));
                dir = path.join(out, dir);
                var err = yield* mkdirs(co, dir);
                if (err) {
                    console.error("Can't create output directory for package: " + file);
                    continue;
                }
            }
            for (var i = 0; i < package.files.length; i++){
                if (verbose) console.error("Extracting " + path.basename(file) + " -> " + package.files[i].name + "...");
                let os = fs.createWriteStream(path.join(dir, package.files[i].name));
                package.files[i].createReadStream().pipe(os);
                os.on("close", function() { co(); });
                os.on("error", function(err) { co(err); });
                //Wait for stream to finish
                var [err] = yield;
                if (err) {
                    console.error("Error occurred while extracting file.");
                }
            }
        }
    }
}

function* packMode(co) {
    //Count all files
    var files = [];
    for (var i = 0; i < input.length; i++) {
        var [err, stats] = yield fs.stat(input[i], co);
        if (err) {
            console.error("File not found: " + input[i] + ".");
        } else {
            if (stats.isDirectory()) {
                //Add contents
                var [err, list] = yield fs.readdir(input[i], co);
                if (err) {
                    console.error("No access to directory: " + input[i]);
                } else {
                    for (var k = 0; k < list.length; k++){
                        let p = path.join(input[i], list[k]);
                        var [err, stats] = yield fs.stat(p, co);
                        if (err) {
                            console.error("File not found: " + p);
                        } else {
                            files.push({
                                path: p,
                                size: stats.size
                            });
                        }
                    }
                }
            } else {
                files.push({
                    path: input[i],
                    size: stats.size
                });
            }
        }
    }
    console.error("Packing " + files.length + " into " + out + "...");
    if (files.length > 0) {
        //Great place to sort files
        let hdr = files.length * 80 + 8;

        var [err, fd] = yield fs.open(out, 'w', co);
        if (err) {
            console.error("Error occurred when packing data.");
            process.exit(4);
        }

        //Write file data
        let xb = Buffer.alloc(8);
        for (var i = 0; i < files.length; i++){
            let [err, srcbuf] = yield fs.readFile(files[i].path, co);
            if (err) {
                console.error("IO error occurred.");
                console.error(err);
                process.exit(4);
            }

            let fr = new FileRecord(path.basename(files[i].path), -1, files[i].size, -1, 0);
            
            let isCompressed = false;
            if (compress) {
                let zbuf = LZCompress(srcbuf, compress > 1);
                if (isCompressed = (compress <= 2 || zbuf.length < srcbuf.length)) 
                    srcbuf = zbuf;
            }
            fr.offset = hdr;
            fr.compressedSize = srcbuf.length;
            fr.flags = isCompressed ? FileRecord.prototype.FLAG_COMPRESSED : 0;
            hdr += srcbuf.length;

            [err] = yield fs.write(fd, srcbuf, 0, srcbuf.length, fr.offset, co);
            if (err) {
                console.error("IO error occurred.");
                console.error(err);
                process.exit(4);
            }

            if (verbose) console.error("File " + (fr.name + ", ").rpad(" ", 24) + "written " + (fr.compressedSize.toCapacityString() + ", ").lpad(" ", 10) + "source " + (files[i].size.toCapacityString() + ", ").lpad(" ", 10) + "compression rate " + (fr.compressedSize/fr.size*100).toFixed(1).lpad(" ", 6) + "%");
            files[i] = fr;
        }
        //Write header
        if (verbose) console.error("Writing header...");

        let buffer = Buffer.alloc(80);
        buffer.writeUInt32LE(0, 0);
        buffer.writeUInt32LE(files.length, 4);
        var [err] = yield fs.write(fd, buffer, 0, 8, 0, co);
        if (err) {
            console.error("IO error occurred.");
            console.error(err);
            process.exit(4);
        }
        let offset = 8;
        for (var i = 0; i < files.length; i++){
            files[i].writeHeader(buffer, 0);
            var [err] = yield fs.write(fd, buffer, 0, buffer.length, offset, co);
            if (err) {
                console.error("IO error occurred.");
                console.error(err);
                process.exit(4);
            }
            offset += 80;
        }
        yield fs.close(fd, co);
    } else {
        console.error("No files to pack.");
    }
}

class FileRecord{
    /**
     * @param {string} name
     * @param {number} offset
     * @param {number} size
     * @param {number} compressedSize
     * @param {number} flags
     */
    constructor(name, offset, size, compressedSize, flags) {
        this.name = name;
        this.offset = offset;
        this.size = size;
        this.compressedSize = compressedSize;
        this.flags = flags;
        this.srcFile = null;
    };
    createReadStream() {
        if (this.srcFile) {
            var stream = fs.createReadStream(this.srcFile, {
                autoClose: true,
                start: this.offset,
                end: this.offset + this.compressedSize - 1
            });
            if (this.flags & this.FLAG_COMPRESSED) {
                var u = new LZDecompressStream((this.flags & this.FLAG_LOCAL_HDR) ? 4 : 0);
                stream.pipe(u);
                return u;
            }
            return stream;
        } else {
            throw new Error("Detached file records can't be read.");
        }
    };
    /** @param {Buffer} buffer */
    writeHeader(buffer, offset) {
        buffer.fill(0, offset, offset + 80);
        buffer.write(this.name, offset, 64, "utf8");
        buffer.writeUInt32LE(this.size, offset + 64);
        buffer.writeUInt32LE(this.compressedSize, offset + 68);
        buffer.writeUInt32LE(this.offset, offset + 72);
        buffer.writeUInt32LE(this.flags, offset + 76);
    }
}
FileRecord.prototype.FLAG_COMPRESSED = 0x1;
FileRecord.prototype.FLAG_LOCAL_HDR = 0x2;

class Package {
    constructor() {
        /** @type {FileRecord[]} */
        this.files = [];
        this.src = null;
    };
    open(srcfile, callback) {
        this.src = srcfile;
        co(this._readHeader, this, srcfile, callback);
    };
}
Package.prototype._readHeader = function* (co, package, srcfile, callback) {
    var [err, fd] = yield fs.open(srcfile, fs.constants.O_RDONLY, co);
    if (err) callback(err);    
    else {
        var [err, stats] = yield fs.stat(srcfile, co);
        var buf = Buffer.alloc(4096);
        var [err, read] = yield fs.read(fd, buf, 0, buf.length, 0, co);
        if (err) {
            callback(err);
            return;
        } else {
            //Using first four bytes as marker, since every file i've seen has them set to 0
            if (buf.readUInt32LE(0) == 0x0) {
                var records = buf.readUInt32LE(4);
                var pos = read, bofs = 0;
                //Sanity check, file length must be greater than or equal to expected length of header
                if (stats.size < records * 80 + 8) {
                    callback(new Error("File runs short, expected header size " + (records * 80 + 2) + ", got " + stats.size));
                    return;
                }
                bofs += 8;
                while (records > 0) {
                    if (read - bofs < 80) {
                        //Read another chunk
                        buf.copy(buf, 0, bofs, read);
                        read -= bofs;
                        var [err, readB] = yield fs.read(fd, buf, read, buf.length - read, pos, co);
                        if (err) {
                            callback(err);
                            return;
                        } else if (readB == 0) {
                            //File ended
                            callback(new Error("Unexpected end of file."));
                            return;
                        }
                        pos += readB;
                        read += readB;
                        bofs = 0;
                    } else {
                        let name = buf.slice(bofs, bofs + 64).toString("utf8");
                        if (name.indexOf("\x00") > -1) name = name.substr(0, name.indexOf("\x00"));
                        let size = buf.readUInt32LE(bofs + 64);
                        let compressedSize = buf.readUInt32LE(bofs + 68);
                        let offset = buf.readUInt32LE(bofs + 72);
                        let flags = buf.readUInt32LE(bofs + 76);
                        package.files.push(new FileRecord(name, offset, size, compressedSize, flags));
                        package.files[package.files.length - 1].srcFile = srcfile;
                        records--;
                        bofs += 80;
                    }
                }
            }
        }

        yield fs.close(fd, co);
        callback();
    }
}

function LZCompress(buffer, exhaustive) {
    var ptr = 0;
    var dptr = 12;
    
    //Analyze contents to decide on mark byte value
    var map = [];
    for (var i = 0; i < 256; i++)
        map[i] = 0;
    for (var i = 0; i < buffer.length; i++){
        map[buffer[i]]++;
    }
    var mark = 0;
    for (var i = 1; i < 256; i++){
        if (map[mark] > map[i]) mark = i;
    }
    var dst = Buffer.alloc(buffer.length + 12 + map[mark]); //Assume worst case (12 byte header + double bytes on every occurence of mark byte)
    
    while (ptr < buffer.length) {
        /*
            Search for matching byte in window
        */
        let b = buffer[ptr];
        let e = Math.min(255, ptr);
        let m = 0; l = 0;
        for (var i = 4; i < e; i++){
            if (buffer[ptr - i] == b) {
                //Found first match
                let s = 1;
                let ds = ptr - i;
                while (s + ptr < buffer.length && (s < i)) {
                    if (buffer[ptr + s] != buffer[ds + s])
                        break;
                    else s++;
                }
                if (l < s) {
                    l = s;
                    m = i;
                }
                if (l > 3 && !exhaustive) break;
            }
        }
        if (l > 3) {
            dst[dptr++] = mark;
            if (m >= mark) m++;
            dst[dptr++] = m;
            dst[dptr++] = l;
            ptr += l;
        } else {
            if (b == mark) dst[dptr++] = b;
            dst[dptr++] = buffer[ptr++];
        }
    }
    dst.writeUInt32LE(buffer.length, 0);
    dst.writeUInt32LE(dptr, 4);
    dst.writeUInt32LE(mark, 8);
    return dst.slice(0, dptr);
}

class LZDecompressStream extends stream.Transform {
    constructor(skipBytes) {
        super();
        this.window = Buffer.alloc(1024);
        this.windowPtr = 0;
        this.dataLen = 0;

        this._lof = Buffer.alloc(32);
        this._lofLen = 0;

        this.streamPtr = 0;
        this.compSize = 0;
        this.dataSize = 0;
        this.mark = 0;
        this.skipBytes = skipBytes;
    };
    _transform(chunk, encoding, callback) {
        var ptr = 0;
        var pskip = 0;
        if (this._lofLen > 0) {
            chunk = Buffer.concat([this._lof.slice(0, this._lofLen), chunk]);
            this._lofLen = 0;
        }
        while (ptr < chunk.length) {
            if (this.skipBytes > 0) {
                let amt = Math.min(this.skipBytes, chunk.length - ptr);
                ptr += amt;
                this.skipBytes -= amt;
                pskip = amt;
            } else if (this.streamPtr == 0) {
                this.dataSize = chunk.readUInt32LE(0);
                this.compSize = chunk.readUInt32LE(4);
                this.mark = chunk.readUInt8(8);
                this.streamPtr += 12;
                ptr += 12;
                pskip += 12;
            } else {
                let cptr = 0;
                let cend = 0;
                while (true) {
                    if (this.dataLen == 1024) {
                        let o = Buffer.alloc(1024);
                        this.windowPtr &= 1023;
                        this.window.copy(o, 0);
                        this.push(o);
                        this.dataLen = 0;
                    } else if (cptr < cend) {
                        //Transform to array copy
                        this.window[this.windowPtr++ & 1023] = this.window[cptr++ & 1023];
                        this.dataLen++;
                    } else if (ptr < chunk.length) {
                        let b = chunk[ptr++];
                        if (b == this.mark) {
                            if (ptr + 1 < chunk.length) {
                                b = chunk[ptr++];
                                if (b != this.mark) {
                                    cptr = b;
                                    if (cptr > this.mark) cptr--;
                                    cptr = this.windowPtr - cptr;
                                    cend = chunk[ptr++] + cptr;
                                } else {
                                    this.window[this.windowPtr++ & 1023] = this.mark;
                                    this.dataLen++;
                                }
                            } else {
                                //Not enough data in buffer, stash bits and wait for more
                                chunk.copy(this._lof, 0, ptr - 1);
                                this._lofLen = chunk.length - ptr + 1;
                                ptr += 1000;
                            }
                        } else {
                            this.window[this.windowPtr++ & 1023] = b;
                            this.dataLen++;
                        }
                    } else
                        break;    
                }
            }
        }
        this.streamPtr += chunk.length - this._lofLen - pskip;
        callback();
    };
    _flush(callback) {
        var o = Buffer.alloc(this.dataLen);
        this.window.copy(o, 0, 0, this.dataLen);
        this.push(o);
        callback();
    };
}

String.prototype.rpad = function(char, length) {
    var out = this;
    while (out.length < length) out += char;
    return out;
}
String.prototype.lpad = function(char, length) {
    var out = this;
    while (out.length < length) out = char + out;
    return out;
}
Number.prototype.toCapacityString = function() {
    if (this < 1000) {
        return this + "B";
    } else if (this < 1e4) {
        return (this / 1024).toFixed(2) + "KiB";
    } else if (this < 1e5) {
        return (this / 1024).toFixed(1) + "KiB";
    } else if (this < 1e6) {
        return (this / 1024).toFixed(0) + "KiB";
    } else if (this < 1e7) {
        return (this / 1048576).toFixed(2) + "MiB";
    } else if (this < 1e8) {
        return (this / 1048576).toFixed(1) + "MiB";
    } else if (this < 1e9) {
        return (this / 1048576).toFixed(0) + "MiB";
    } else if (this < 1e10) {
        return (this / 1073741824).toFixed(2) + "GiB";
    } else if (this < 1e11) {
        return (this / 1073741824).toFixed(1) + "GiB";
    } else {
        return (this / 1073741824).toFixed(0) + "GiB";
    }
}

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
    FLAG_LOCAL_HDR      0x2     Means that file data prepended by 4-byte local header.

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