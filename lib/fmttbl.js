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
 *  Format library - TBL spreadsheet (Tokyo Xanadu)
 */

var _init = false;
var _debug = function() { };
var _types = Object.create(null);

class TypeDef{
    /**
     * @param {string} name 
     * @param {string} def 
     */
    constructor(name, def) {
        this.name = name;
        this.schema = [];
        def = def.split(",");
        for (var i = 0; i < def.length; i++){
            let d = def[i].trim();
            let n = d.substr(1);
            if (n == "*")
                n = Infinity;
            else
                n = parseInt(n);
            if (isNaN(n)) {
                console.error("Invalid type specifier '" + d + "' found in config for table '" + this.name + "'.");    
                process.exit(2);
            }
            switch (d[0]) {
                case "b":
                    this.schema.push(this.TYPE_BYTES, n);
                    break;
                case "i":
                    this.schema.push(this.TYPE_INT, n);
                    break;
                case "u":
                    this.schema.push(this.TYPE_UINT, n);
                    break;
                case "f":
                    this.schema.push(this.TYPE_FLOAT, n);
                    break;
                case "c":
                    this.schema.push(this.TYPE_CSTR, n);
                    break;
                default:
                    console.error("Invalid type specifier '" + d + "' found in config for table '" + this.name + "'.");    
                    process.exit(2);
            }
        }
    };
    /** @param {Buffer} buffer */
    parse(buffer, arr) {
        let ofs = 0;
        for (var i = 0; i < this.schema.length; i += 2){
            let t = this.schema[i];
            let l = this.schema[i + 1];
            switch (t) {
                case this.TYPE_BYTES:
                    let amt = Math.min(ofs + l, buffer.length);
                    arr.push([buffer.slice(ofs, amt).toString("hex")]);
                    ofs = amt;
                    break;
                case this.TYPE_UINT:
                    arr.push(buffer.readUIntLE(ofs, l));
                    ofs += l;
                    break;
                case this.TYPE_INT:
                    arr.push(buffer.readIntLE(ofs, l));
                    ofs += l;
                    break;
                case this.TYPE_FLOAT:
                    if (l == 4) {
                        arr.push(buffer.readFloatLE(ofs));
                    } else if (l == 8) {
                        arr.push(buffer.readDoubleLE(ofs));
                    } else {
                        arr.push([buffer.slice(ofs, ofs + l).toString("hex")]);
                    }
                    ofs += l;
                    break;
                case this.TYPE_CSTR: {
                    let t = TypeDef.readCString(buffer, ofs);
                    arr.push(t.toString());
                    ofs += t.length + 1;
                    break;
                }
            }
        }
    };
    /**
     * @param {Buffer} buffer 
     * @param {number} offset 
     * @param {Row} row 
     */
    encode(buffer, offset, row) {
        let shift = offset;
        for (var i = 0; i < row.values.length; i++){
            let t = this.schema[i * 2];
            let l = this.schema[i * 2 + 1];
            switch (t) {
                case this.TYPE_BYTES: {
                    let b = Buffer.from(row.values[i][0], "hex");
                    b.copy(buffer, shift, 0);
                    shift += b.length;
                    break;
                }
                case this.TYPE_INT: {
                    shift = buffer.writeIntLE(row.values[i], shift, l);
                    break;
                }
                case this.TYPE_UINT: {
                    shift = buffer.writeUIntLE(row.values[i], shift, l);
                    break;
                }
                case this.TYPE_FLOAT: {
                    if (Array.isArray(row.values[i])) {
                        let b = Buffer.from(row.values[i][0], "hex");
                        b.copy(buffer, shift, 0);
                        shift += l;
                    } else {
                        if (l > 4) {
                            shift = buffer.writeDoubleLE(row.values[i], shift);
                        } else {
                            shift = buffer.writeFloatLE(row.values[i], shift);
                        }
                    }
                    break;
                }
                case this.TYPE_CSTR: {
                    shift += buffer.write(row.values[i] + "\u0000", shift);
                    break;
                }
            }
        }
        return shift - offset;
    };
    toString() {
        var out = "";
        var map = "buifc";
        for (var i = 0; i < this.schema.length; i += 2){
            if (this.schema[i + 1] == Infinity) {
                out += map[this.schema[i]] + "*, ";
            } else 
                out += map[this.schema[i]] + this.schema[i + 1] + ", ";
        }
        return out.substr(0, out.length - 2);
    }
    /** @return {string} */
    static readCString(buffer, offset) {
        let pos = offset-1;
        while (++pos < buffer.length && buffer[pos] != 0);
        return buffer.slice(offset, pos);
    };
}
TypeDef.prototype.TYPE_BYTES = 0;
TypeDef.prototype.TYPE_UINT = 1;
TypeDef.prototype.TYPE_INT = 2;
TypeDef.prototype.TYPE_FLOAT = 3;
TypeDef.prototype.TYPE_CSTR = 4;

class Table{
    /**
     * @param {string} name
     * @param {number} rowCount
     */
    constructor(name, rowCount) {
        this.name = name;
        this.schema = "";
        this.count = rowCount;
        /** @type {Row[]} */
        this.rows = [];
    }
}

class Row {
    constructor() {
        this.values = [];
    };
    static replacer(key, value) {
        if (value instanceof Row) {
            let out = {
                row_id: value.row_id
            };
            for (var i = 0; i < value.values.length; i++){
                let n = i.toString();
                while (n.length < 2) n = "0" + n;
                n = "v" + n;
                out[n] = value.values[i];
            }
            return out;
        }
        return value;
    };
}

/**
 * Initializes format library.
 * @param {function(string):void} debug debug interface for verbose loggin
 * @param {string} typedefs string with type definitions
 * @param {function(Error):void} callback
 */
module.exports.init = function(debug, typedefs, callback) {
    if (_init) {
        _init = false;
        _types = Object.create(null);
    } else {
        _init = true;
    }
    if (typeof debug == "function") _debug = debug;
    
    typedefs = typedefs.split(/\n|\r|\r\n/);
    let formatRegex = /(.+?)\s*\:\s*(.+)/;
    let types = 0;
    for (let i = 0; i < typedefs.length; i++) {
        let line = typedefs[i].trim();
        if (line.length > 0) {
            //Skip over comment lines
            if (line[0] != "#") {
                let m = formatRegex.exec(line);
                if (m) {
                    _types[m[1]] = new TypeDef(m[1], m[2]);
                    types++;
                }
            }
        }
    }
    _debug(`Initialized TBL format library with ${types} data types definitions.`);

    if (typeof callback == "function")
        process.nextTick(callback);
}

/**
 * Decodes binary buffer in TBL format.
 * @param {Buffer} input
 * @param {function(Error, Map<string, Table>):void} callback
 */
module.exports.decode = function(input, callback) {
    if (_init) {
        try {
            let ofs = 6;
            let total_row_count = input.readUInt16LE(0);
            let table_count = input.readUInt32LE(2);
            _debug("Opened tbl file, total rows: " + total_row_count + ", tables: " + table_count);
            let tables = Object.create(null);
            for (let j = 0; j < table_count; j++) {
                let t = TypeDef.readCString(input, ofs);
                ofs += t.length + 1;
                t = t.toString();
                let c = input.readUInt32LE(ofs);
                ofs += 4;
                tables[t] = new Table(t, c);
                if (_types[t]) {
                    tables[t].schema = _types[t].toString();
                    _debug("Found table " + t + " with " + c + (c == 1 ? " row" : " rows") + ", schema: " + tables[t].schema);
                } else {
                    _debug("Found table " + t + " with " + c + (c == 1 ? " row" : " rows") + ", applied generic schema");
                    tables[t].schema = "b*";
                }
            }
            while (ofs < input.length) {
                let t = TypeDef.readCString(input, ofs);
                ofs += t.length + 1;
                t = t.toString();
                let size = input.readUInt16LE(ofs);
                ofs += 2;
                let b = input.slice(ofs, ofs + size);
                ofs += size;
                let row = new Row();
                if (_types[t]) {
                    _types[t].parse(b, row.values);
                } else {
                    row.values.push([b.toString("hex")]);
                }
                tables[t].rows.push(row);
            }

            process.nextTick(callback.bind(null, null, tables));
        } catch (e) {
            process.nextTick(callback.bind(null, e));
        }    
    } else {
        process.nextTick(callback.bind(null, new Error("Format library is not intialized.")));
    }
}

/**
 * Serializes tables in JSON format.
 * @param {Map<string, Table>} tables
 * @param {function(Error, string):void} callback
 */
module.exports.serialize = function(tables, callback) {
    process.nextTick(callback.bind(null, null, JSON.stringify(tables, Row.replacer, 4)));
}

/**
 * Deserializes JSON back into tables map.
 * @param {string} json
 * @param {function(Error, Map<string, Table>):void} callback
 */
module.exports.deserialize = function(json, callback) {
    var indices = [];
    for (var i = 0; i < 100; i++){
        let c = i.toString();
        while (c.length < 2) c = "0" + c;
        indices.push("v" + c);
    }
    try {
        var obj = JSON.parse(json);
        var tables = Object.create(null);
        for (var i = 0; i < obj.length; i++) {
            let table = new Table(obj[i].name, obj[i].rows.length);
            table.schema = obj[i].schema;
            for (var j = 0; j < obj[i].rows.length; j++) {
                let irow = obj[i].rows[j];
                let row = new Row();
                for (var s = 0; s < indices.length; s++) {
                    let v = irow[indices[s]];
                    if (v === undefined) break;
                    row.values.push(v);
                }
                table.rows.push(row);
            }
        }
        process.nextTick(callback.bind(null, null, tables));
    } catch (e) {
        process.nextTick(callback.bind(null, e));
    }    
}

/**
 * Encodes object in TBL format.
 * @param {Map<string, Table>} tables
 * @param {function(Error, Buffer):void} callback
 */
module.exports.encode = function(tables, callback) {
    if (_init) {
        let buf = Buffer.alloc(0x10000);
        let optr = 6;
        let row_count = 0, table_count = 0;
        for (var i in tables) {
            //Count rows
            row_count += tables[i].rows.length;
            table_count++;
            let t = tables[i].name + "\u0000";
            optr += buf.write(t, optr);
            optr = buf.writeUInt32LE(tables[i].rows.length, optr);
        }
        buf.writeUInt16LE(row_count, 0);
        buf.writeUInt32LE(table_count, 2);

        _debug("Found " + row_count + " rows in " + table_count + " tables.");

        for (var i in tables) {
            let rows = tables[i].rows;
            let title = i + "\u0000";
            let dtype = new TypeDef(i, tables[i].schema);
            for (var j = 0; j < rows.length; j++){
                optr += buf.write(title, optr);
                let ind = optr;
                optr += 2;
                let rowlen = dtype.encode(buf, optr, rows[j]);
                buf.writeUInt16LE(rowlen, ind);
                optr += rowlen;

                if (optr - buf.length < 1024) {
                    let b2 = Buffer.alloc(buf.length * 2);
                    buf.copy(b2, 0);
                    buf = b2;
                }
            }
        }

        process.nextTick(callback.bind(null, null, buf.slice(0, optr)));
    } else {
        process.nextTick(callback.bind(null, new Error("Format library is not intialized.")));
    }
}