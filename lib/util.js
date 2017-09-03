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
 *  Various bits and pieces of code useful everywhere.
 */

var path = require("path");
var stream = require("stream");

module.exports.strexp = function(char, length) {
    var str = "";
    while (str.length < length) str += char;
    return str;
}

module.exports.lpad = function(str, char, length) {
    if (typeof str != "string") str += "";
    while (str.length < length) str = char + str;
    return str;
}

module.exports.rpad = function(str, char, length) {
    if (typeof str != "string") str += "";
    while (str.length < length) str += char;
    return str;
}

module.exports.replaceExt = function(file, newExt) {
    let ext = path.extname(file);
    if (ext) {
        return file.substr(0, file.length - ext.length) + "." + newExt;
    }
    return file + "." + newExt;
}
module.exports.stripExt = function(file) {
    let ext = path.extname(file);
    if (ext) {
        return file.substr(0, file.length - ext.length);
    }
    return file;
}

/**
 * Aligns number to nearest unit.
 * @param {number} num offset to align
 * @param {number} alignment unit size
 */
module.exports.align = function(num, alignment) {
    return num + ((alignment - (num % alignment)) % alignment);
}
module.exports.round = function(num, prec) {
    return Math.round(num / prec) * prec;
}
module.exports.formatSize = function(num) {
    if (num < 1000) {
        return num + "B";
    } else if (num < 1e4) {
        return (num / 1024).toFixed(2) + "KiB";
    } else if (num < 1e5) {
        return (num / 1024).toFixed(1) + "KiB";
    } else if (num < 1e6) {
        return (num / 1024).toFixed(0) + "KiB";
    } else if (num < 1e7) {
        return (num / 1048576).toFixed(2) + "MiB";
    } else if (num < 1e8) {
        return (num / 1048576).toFixed(1) + "MiB";
    } else if (num < 1e9) {
        return (num / 1048576).toFixed(0) + "MiB";
    } else if (num < 1e10) {
        return (num / 1073741824).toFixed(2) + "GiB";
    } else if (num < 1e11) {
        return (num / 1073741824).toFixed(1) + "GiB";
    } else {
        return (num / 1073741824).toFixed(0) + "GiB";
    }
}

module.exports.readCSTR = function(buffer, start, end) {
    var ptr = start - 1;
    while (ptr < end && buffer[++ptr] != 0);
    return buffer.slice(start, ptr).toString("utf8");
}

module.exports.BufferWriteStream = class BufferWriteStream extends stream.Writable {
    constructor() {
        super();
        this._buf = [];
    };
    _write(chunk, encoding, callback) {
        this._buf.push(chunk);
        callback();
    };
    get() {
        if (Array.isArray(this._buf)) {
            var len = this._buf.reduce(function(p, v) { return p + v.length }, 0);
            var b = Buffer.alloc(len);
            var pos = 0;
            this._buf.forEach(function(v) {
                v.copy(b, pos, 0, v.length);
                pos += v.length;
            });
            this._buf = b;
        }
        return this._buf;
    }
}

module.exports.BufferReadStream = class BufferReadStream extends stream.Readable {
    constructor(bufs) {
        super();
        if (Array.isArray(bufs))
            this._buf = bufs;
        else
            this._buf = [bufs];
        this._ptr = 0;
    };
    _read(size) {
        while (this._ptr < this._buf.length) {
            if (!this.push(this._buf[this._ptr++]))
                break;
        }
        if (this._ptr >= this._buf.length)
            this.push(null);
    }
}