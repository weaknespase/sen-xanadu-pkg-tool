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
 *  A variant of pure LZ77 codec library (Found in PKG format - Tokyo Xanadu)
 *  Stream-based version
 */

var stream = require("stream");

function* compress(mark) {
    var wrk = Buffer.alloc(0x8000);
    var out = Buffer.alloc(0x8000);
    var wptr = 0, ds = 0;
    var srcp = 0, optr = 0;
    var hasNext = true;
    var src = null;

    //Write mark to stream    
    optr = out.writeUInt32LE(mark, 0);
    
    var loadNextChunk = function* () {
        var loadNextChunkData = function() {
            //Move enough bytes to keep reference window intact
            let mb = Math.min(wptr, 256);
            wrk.copy(wrk, 0, wptr - mb, ds);
            let ts = ds - wptr + mb;
            let cb = Math.min(src.length - srcp, wrk.length - ts);
            src.copy(wrk, ts, srcp, srcp + cb);
            srcp += cb;
            wptr = mb; ds = ts + cb;
        }
        if (!src || src.length <= srcp) {
            src = yield false;
            if (src instanceof Buffer) {
                srcp = 0;
                loadNextChunkData();
                return true;
            } else {
                return false;
            }
        } else {
            loadNextChunkData();
            return true;
        }
    }

    while (true) {
        if (wptr >= ds) {
            if (!hasNext || !(yield* loadNextChunk())) {
                //Finish compression
                break;
            }
        } else {
            let b = wrk[wptr];
            let e = Math.min(255, wptr);
            let m = 0, l = 0;

            for (var i = 4; i < e; i++) {
                if (wrk[wptr - i] == b) {
                    let s = 1;
                    let xs = wptr - i;
                    while (s < i) {
                        //Check buffer length
                        if (wptr + s >= ds) {
                            if (!hasNext || !(yield* loadNextChunk())) {
                                hasNext = false;
                                e = s;
                                break;
                            }
                            xs = wptr - i;
                        } else {
                            if (wrk[wptr + s] != wrk[xs + s])
                                break;
                            else s++;
                        }
                    }
                    if (l < s) {
                        l = s;
                        m = i;
                    }
                }
            }

            if (optr + 3 >= out.length) {
                yield out.slice(0, optr);
                optr = 0;
            }
            if (l > 3) {
                out[optr++] = mark;
                if (m >= mark) m++;
                out[optr++] = m;
                out[optr++] = l;
                wptr += l;
            } else {
                if (b == mark) out[optr++] = b;
                out[optr++] = wrk[wptr++];
            }
        }
    }
    if (optr > 0)
        yield out.slice(0, optr);
}

function* expand() {
    //Read mark from first buffer
    var wrk = Buffer.alloc(0x10000);
    var wptr = 0, wr = 0, ds = 0;
    var srcp = 0;
    var hasNext = true;
    var src = null;
    var mark = -1;
    var pendingError = null;

    var loadNextChunk = function* () {
        if (!src || src.length <= srcp) {
            src = yield false;
            if (src instanceof Buffer) {
                srcp = 0;
                return true;
            } else {
                return false;
            }
        } else {
            return true;
        }
    }

    while (hasNext) {
        if (!src || src.length <= srcp) {
            if (!(yield* loadNextChunk())) {
                //Finish compression
                hasNext = false;
            }
        } else if (mark < 0) {
            //Read mark byte
            mark = src.readUInt32LE(0) & 0xff;
            srcp += 4;
        } else {
            let b = src[srcp++];
            if (b == mark) {
                if (srcp >= src.length) {
                    if (!(yield* loadNextChunk())) {
                        //Input ended prematurely
                        pendingError = new Error("Unexpected end of stream.");
                        hasNext = false;
                        break;
                    }
                }
                let b1 = src[srcp++];
                if (b1 == mark) {
                    wrk[wptr++] = mark;
                } else {
                    if (srcp >= src.length) {
                        if (!(yield* loadNextChunk())) {
                            //Input ended prematurely
                            pendingError = new Error("Unexpected end of stream.");
                            hasNext = false;
                            break;
                        }
                    }
                    let len = src[srcp++];
                    if (b1 > mark) b1--;
                    //Copy referenced bytes
                    if (wptr + len >= wrk.length) {
                        yield wrk.slice(wr, wptr);
                        wrk.copy(wrk, 0, wptr - 256, wptr);
                        wptr = wr = 256;
                    }
                    wrk.copy(wrk, wptr, wptr - b1, wptr + len);
                    wptr += len;
                }        
            } else {
                if (wptr >= wrk.length) {
                    yield wrk.slice(wr);
                    wrk.copy(wrk, 0, wptr - 256);
                    wptr = wr = 256;
                }
                wrk[wptr++] = b;
            }
        }
    }
    if (wptr - wr > 0) {
        yield wrk.slice(wr, wptr);
    }
    return pendingError;
}

class LZCompressStream extends stream.Transform {
    /**
     * Constructs new compression stream using specified mark byte.
     * To get best possible compression, mark byte must be least frequent
     * in source stream.
     * @param {number} mark value of mark byte, integer in range 0-255.
     */
    constructor(mark) {
        super();
        this._compressor = compress(mark);
        this._mode = this._compressor.next();
        this._bytes = this._ibytes = 0;
        if (this._mode.value !== false)
            throw new Error("Invalid internal compressor state.");
    };
    _transform(chunk, encoding, callback) {
        this._mode = this._compressor.next(chunk);
        this._ibytes += chunk.length;
        while (this._mode.value !== false) {
            this.push(Buffer.from(this._mode.value));
            this._bytes += this._mode.value.length;
            this._mode = this._compressor.next();
        }
        callback();
    };
    _flush(callback) {
        this._mode = this._compressor.next();
        if (this._mode.value !== false) {
            this.push(this._mode.value);
            this._bytes += this._mode.value.length;
        }
        callback();
    };
}
Object.defineProperties(LZCompressStream.prototype, {
    "outputBytes": {
        get: function() { return this._bytes; }
    },
    "inputBytes": {
        get: function() { return this._ibytes; }
    }
});

class LZExpandStream extends stream.Transform {
    constructor() {
        super();
        this._expander = expand();
        this._mode = this._expander.next();
        this._bytes = this._ibytes = 0;
        if (this._mode.value !== false)
            throw new Error("Invalid internal expander state.");
    };
    _transform(chunk, encoding, callback) {
        this._mode = this._expander.next(chunk);
        this._ibytes += chunk.length;
        while (this._mode.value !== false) {
            if (this._mode.done) {
                this.callback(this._mode.value);
                return;
            } else {
                this.push(Buffer.from(this._mode.value));
                this._bytes += this._mode.value.length;
            }    
            this._mode = this._expander.next();
        }
        callback();
    }
    _flush(callback) {
        this._mode = this._expander.next();
        while (!this._mode.done) {
            if (this._mode.value !== false) {
                this.push(this._mode.value);
                this._bytes += this._mode.value.length;
            }
            this._mode = this._expander.next();
        }
        if (this._mode.value instanceof Error) {
            callback(this._mode.value);
        } else
            callback();
        //console.log("Expand stream completed emit " + this._bytes + " bytes from " + this._ibytes + " bytes");
    }
}
Object.defineProperties(LZExpandStream.prototype, {
    "outputBytes": {
        get: function() { return this._bytes; }
    },
    "inputBytes": {
        get: function() { return this._ibytes; }
    }
});

class LZAnalyzeStream extends stream.Writable {
    constructor() {
        super();
        this.bins = new Array(256);
        this.bins.fill(0, 0, 256);
        this._written = 0;
    };
    _write(chunk, encoding, callback) {
        for (var i = 0; i < chunk.length; i++) {
            this.bins[chunk[i]]++;
        }
        this._written += chunk.length;
        callback();
    };
}
Object.defineProperties(LZAnalyzeStream.prototype, {
    "leastFrequentByte": {
        get: function() {
            return this.bins.reduce(function(p, v, i, a) {
                return a[p] > v ? i : p;
            }, 0);
        }
    },
    "mostFrequentByte": {
        get: function() {
            return this.bins.reduce(function(p, v, i, a) {
                return a[p] < v ? i : p;
            }, 0);
        }
    },
    "bytesWritten": {
        get: function() {
            return this._written;
        }
    }
});

class BufferChainWriteStream extends stream.Writable{
    constructor() {
        super();
        this.chain = [];
    };
    _write(chunk, encoding, callback) {
        this.chain.push(Buffer.from(chunk));
        callback(null);
    };
}


module.exports.CompressStream = LZCompressStream;
module.exports.ExpandStream = LZExpandStream;
module.exports.AnalyzeStream = LZAnalyzeStream;

/**
 * Convenience function, compresses buffer in one go.
 * @param {Buffer} buffer data to compress.
 * @param {function(Error, Buffer): void} callback
 */
module.exports.compress = function compressBuffer(buffer, callback) {
    var src = new stream.Readable();
    src.push(buffer);
    src.push(null);

    var as = new LZAnalyzeStream();
    as.on("finish", function() {
        var mark = as.leastFrequentByte;
        var dst = new BufferChainWriteStream();
        dst.on("finish", function() {
            callback(null, Buffer.concat(dst.chain));
        });
        var src = new stream.Readable();
        src.push(buffer);
        src.push(null);
        src.pipe(new LZCompressStream(mark)).pipe(dst);
    });
}

/**
 * Convenience function, expands buffer in one go.
 * @param {Buffer} buffer data to expand.
 * @param {function(Error, Buffer): void} callback
 */
module.exports.expand = function expandBuffer(buffer, callback) {
    var src = new stream.Readable();
    src.push(buffer);
    src.push(null);

    var dst = new BufferChainWriteStream();
    dst.on("finish", function() {
        callback(null, Buffer.concat(dst.chain));
    });
    dst.on("error", function(err) {
        callback(err);
    });
    src.pipe(new LZExpandStream()).pipe(dst);
}