/*
    Converts TBL files into JSON and vise-versa.
    Usage:
        node tbl_codec.js decode [-fv] [-t config] [-o dir] file1 [file2 ... fileN]
        node tbl_codec.js encode [-fv] [-o dir] file1 [file2 ... fileN]
*/

var fs = require("fs");
var path = require("path");
var co = require("./co");

const MODE_HELP = "help";
const MODE_DECODE = "decode";
const MODE_ENCODE = "encode";

var input = [];
var mode = MODE_HELP;
var verbose = false;
var overwrite = false;
var confile = null;
var outdir = null;
{
    //Read arguments
    console.error("TLB_codec - converts TBL files of Tokyo Xanadu to JSON and vice versa.");
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
                        case "v":
                            verbose = true;
                            break;
                        case "t":
                            if (start + 1 >= process.argv.length) {
                                console.error("Missing config file in arguments list.");
                                process.exit(1);
                            }
                            confile = process.argv[start++];
                            break;
                        case "o":
                            if (start + 1 >= process.argv.length) {
                                console.error("Missing output directory in arguments list.");
                                process.exit(1);
                            }
                            outdir = process.argv[start++];
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

class TableTypeDef{
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
                    let t = TableTypeDef.readCString(buffer, ofs);
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
TableTypeDef.prototype.TYPE_BYTES = 0;
TableTypeDef.prototype.TYPE_UINT = 1;
TableTypeDef.prototype.TYPE_INT = 2;
TableTypeDef.prototype.TYPE_FLOAT = 3;
TableTypeDef.prototype.TYPE_CSTR = 4;

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

function* preprocessInput(co) {
    if (outdir) {
        var err = yield* mkdirs(co, outdir);
        if (err) {
            console.error("Can't create output directory.");
            process.exit(2);
        }
    }

    //Unwrap first level of directories    
    for (var i = 0; i < input.length; i++){
        let [err, stats] = yield fs.stat(input[i], co);
        if (err) {
            input.splice(i--, 1);
        } else {
            if (stats.isDirectory()) {
                let [err, list] = yield fs.readdir(input[i], co);
                if (err) {
                    input.splice(i--, 1);
                } else {
                    for (var k = 0; k < list.length; k++){
                        list[k] = path.join(input[i], list[k]);
                    }
                    list.unshift(i, 1);
                    input.splice.apply(input, list);
                    i += list.length - 3;
                }
            }
        }
    }
}

function* modeDecode(co) {
    var dtypes = Object.create(null);
    if (confile) {
        let [err, data] = yield fs.readFile(confile, "utf8", co);
        if (!err) {
            data = data.split(/\n|\r|\r\n/);
            let formatRegex = /(.+?)\s*\:\s*(.+)/;
            for (let i = 0; i < data.length; i++) {
                let line = data[i].trim();
                if (line.length > 0) {
                    //Skip over comment lines
                    if (line[0] != "#") {
                        let m = formatRegex.exec(line);
                        if (m) {
                            dtypes[m[1]] = new TableTypeDef(m[1], m[2]);
                        }
                    }
                }
            }
            console.error("Loaded data schema from " + confile);
        } else {
            console.error("Configuration file is not found.");
            process.exit(2);
        }
    }

    for (var i = 0; i < input.length; i++) {
        let [err, data] = yield fs.readFile(input[i], co);
        if (err) {
            if (err.code == "ENOENT") {
                console.error("File not found: " + input[i]);
            } else if (err.code == "EBUSY") {
                console.error("File " + input[i] + " is exclusively used by another process.");
            } else {
                console.error("Can't read file: " + input[i]);
            }
        } else {
            //Parsing file
            let out = path.basename(input[i]);
            if (out.lastIndexOf(".") > -1) out = out.substr(0, out.lastIndexOf("."));
            out = path.join((outdir ? outdir : path.dirname(input[i])), out + ".json");

            let ofs = 6;
            let total_row_count = data.readUInt16LE(0);
            let table_count = data.readUInt32LE(2);
            if (verbose) console.error("Opened tbl file, total rows: " + total_row_count + ", tables: " + table_count);
            let tables = Object.create(null);
            for (let j = 0; j < table_count; j++) {
                let t = TableTypeDef.readCString(data, ofs);
                ofs += t.length + 1;
                t = t.toString();
                let c = data.readUInt32LE(ofs);
                ofs += 4;
                tables[t] = new Table(t, c);
                if (verbose) console.error("Found table " + t + " with " + c + (c == 1 ? " row" : " rows"));
                if (dtypes[t]) {
                    tables[t].schema = dtypes[t].toString();
                } else {
                    tables[t].schema = "b*";
                }
            }
            while (ofs < data.length) {
                let t = TableTypeDef.readCString(data, ofs);
                ofs += t.length + 1;
                t = t.toString();
                let size = data.readUInt16LE(ofs);
                ofs += 2;
                let b = data.slice(ofs, ofs + size);
                ofs += size;
                let row = new Row();
                if (dtypes[t]) {
                    dtypes[t].parse(b, row.values);
                } else {
                    row.values.push([b.toString("hex")]);
                }
                tables[t].rows.push(row);
            }
            
            let [err, stats] = yield fs.stat(out, co);
            if (err) {
                if (err.code == "ENOENT") {
                    [err] = yield fs.writeFile(out, JSON.stringify(tables, Row.replacer, 4), co);
                    if (err) {
                        console.error("Can't write " + out);
                    } else
                        if (verbose) console.error("Written " + out);
                } else {
                    console.error("Can't write " + out);
                }
            } else {
                if (overwrite) {
                    [err] = yield fs.writeFile(out, JSON.stringify(tables, Row.replacer, 4), co);
                    if (err) {
                        console.error("Can't write " + out);
                    } else {
                        if (verbose) console.error("Written " + out);
                    }
                } else {
                    console.error("File " + out + " already exists.");
                }
            }
        }
    }
}

function* modeEncode(co) {
    var indices = [];
    for (var i = 0; i < 100; i++){
        let c = i.toString();
        while (c.length < 2) c = "0" + c;
        indices.push("v" + c);
    }
    for (var i = 0; i < input.length; i++) {
        if (verbose) console.error("Encoding " + input[i]);
        let [err, data] = yield fs.readFile(input[i], { encoding: "utf8", flag: fs.O_EXCL }, co);
        if (err) {
            if (err.code == "ENOENT") {
                console.error("File not found: " + input[i]);
            } else if (err.code == "EBUSY") {
                console.error("File " + input[i] + " is exclusively used by another process.");
            } else {
                console.error("Can't read file: " + input[i]);
            }
        } else {
            let out = path.basename(input[i]);
            if (out.lastIndexOf(".") > -1) out = out.substr(0, out.lastIndexOf("."));
            out = path.join((outdir ? outdir : path.dirname(input[i])), out + ".tbl");
            
            let [err, ofd] = yield fs.open(out, (overwrite ? "w" : "wx"), co);
            if (err) {
                if (err.code == "EBUSY") {
                    console.error("File " + out + " is used exclusively by another process.");
                } else if (err.code == "EEXIST") {
                    console.error("File " + out + " already exists.");
                } else {
                    console.error("Can't write output file.");
                    console.error(err);
                }
            } else {
                let buf = Buffer.alloc(0x10000);
                let optr = 6, pos = 0;
                let row_count = 0, table_count = 0;
                let tables = JSON.parse(data);
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

                if (verbose) console.error("Found " + row_count + " rows in " + table_count + " tables.");

                [err] = yield fs.write(ofd, buf, 0, optr, pos, co);
                if (err) { console.error("Can't write " + out); process.exit(3); }
                pos += optr; optr = 0;

                for (var i in tables) {
                    let rows = tables[i].rows;
                    let title = i + "\u0000";
                    let dtype = new TableTypeDef(i, tables[i].schema);
                    for (var j = 0; j < rows.length; j++){
                        let row = new Row();
                        for (var s = 0; s < indices.length; s++){
                            let v = rows[j][indices[s]];
                            if (v === undefined) break;
                            row.values.push(v);
                        }
                        optr += buf.write(title, optr);
                        let ind = optr;
                        optr += 2;
                        let rowlen = dtype.encode(buf, optr, row);
                        buf.writeUInt16LE(rowlen, ind);
                        optr += rowlen;

                        if (optr - buf.length < 1024) {
                            [err] = yield fs.write(ofd, buf, 0, optr, pos, co);
                            if (err) { console.error("Can't write " + out); process.exit(3); }
                            pos += optr; optr = 0;
                        }
                    }
                }

                if (optr > 0) {
                    [err] = yield fs.write(ofd, buf, 0, optr, pos, co);
                    if (err) { console.error("Can't write " + out); process.exit(3); }
                    pos += optr; optr = 0;
                }

                yield fs.close(ofd, co);

                if (verbose) console.error("Written " + out);
            }
        }
    }
}

switch (mode) {
    case MODE_HELP:
        console.error("Usage:\n\tnode tbl_codec.js decode [-fv] [-t config] [-o dir] file1 [file2 ... fileN]");
        console.error("\tnode tbl_codec.js encode [-fv] [-o dir] file1 [file2 ... fileN]");
        break;
    case MODE_DECODE:
        co(preprocessInput)
            .run(modeDecode);
        break;
    case MODE_ENCODE:
        co(preprocessInput)    
            .run(modeEncode);    
        break;
    default:
        console.error("Unknown verb '" + mode + "'.");
        process.exit(1);
}