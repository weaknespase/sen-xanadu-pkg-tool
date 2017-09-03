#!/usr/bin/env node

var fs = require("fs");
var path = require("path");
var cliapp = require("../lib/cliapp");
var fmt = require("../lib/fmttbl");

new cliapp.App({
    "banner": "tx-tblconv - TBL files converter for Tokyo Xanadu.",
    "name": "tx-tblconv",
    "arguments": [
        cliapp.defParam("action", "\nencode - Encodes JSON formated data into TBL file\ndecode - Decodes TBL file into JSON file"),
        cliapp.defSwitch("f", "Overwrite existing file"),
        cliapp.defSwitch("v", "Print more information"),
        cliapp.defSwitch("t", "Specify configuration file for record types. If omited default type config will be used", "input", "config", ""),
        cliapp.defSwitch("o", "Specify output directory or file, current directory by default", "output", "output", ""),
        cliapp.defParam("file", "input files", "*input")
    ],
    /**
     * Main function of cli application
     * @param {{}} co coroutine library callback
     * @param {{}} con message output
     * @param {{}} options parsed list of arguments
     */
    "main": function* (co, con, options) {
        if (options.t.length == 0) {
            options.t = path.join(path.dirname(path.dirname(module.filename)), "share", "xanadu_tbls.conf");
        } else {
            options.t = options.t[0];
        }
        options.o = options.o || process.cwd();

        var errorExit = function(message, code) {
            con.error(message);
            process.exit(code);
        }

        //Validate some options
        if (options.file.length == 0) errorExit("No files found to convert.", 1);
        var targExt = "tbl";
        if (options.action == "decode") targExt = "json";

        //Count and map output of files
        var [err, stats] = yield fs.stat(options.o, co);
        var odir = options.o;
        var list = [{
            input: options.file[0],
            output: options.o
        }];
        //libInput already created all required parent directories
        if (err) {
            if (err.code == "ENOENT") {
                //Check if we have more than one file of input
                if (options.file.length > 1) {
                    //Create directory and use it as base
                    let [err] = yield fs.mkdir(options.o);
                    if (err && err.code != "EEXIST") {
                        con.error("Can't create output directory " + options.o + ".");
                        con.error(err.message);
                        process.exit(3);
                    }
                    //Modify first entry address
                    list[0].output = path.join(odir, replace_ext(path.basename(list[0].input), targExt));
                }
            } else errorExit("Output access error.", 2);
        } else {
            if (options.file.length > 1) {
                if (!stats.isDirectory()) {
                    con.error("Output exists as file already, can't create output directory.");
                    process.exit(3);
                } else {
                    list[0].output = path.join(list[0].output, replace_ext(path.basename(list[0].input), targExt));
                }    
            } else if (options.file.length == 1 && stats.isDirectory()) {
                //Modify first entry to point inside exising directory
                list[0].output = path.join(list[0].output, replace_ext(path.basename(list[0].input), targExt));
            }
        }

        //Process other files
        for (var j = 1; j < options.file.length; j++){
            list.push({
                input: options.file[j],
                output: path.join(odir, replace_ext(path.basename(options.file[j]), targExt))
            })
        }

        //Read configuration file and initialize format library
        var [err, data] = yield fs.readFile(options.t, "utf8", co);
        if (err) {
            con.error("Can't load configuration file from " + options.t + ".");
            con.error(err.message);
            process.exit(4);
        } else {
            yield fmt.init(options.v ? con.log : null, data, co);
        }

        if (options.action == "encode") {
            yield* encode_mode(co, con, options.f, list);
        } else if (options.action == "decode") {
            yield* decode_mode(co, con, options.f, list);
        } else errorExit("Invalid mode specified: " + options.action + ".", 1);
    }
});

var encode_mode = function* (co, con, forced, list) {
    for (var i = 0; i < list.length; i++){
        con.log("JSON->TBL " + list[i].input);
        var [err, input] = yield fs.readFile(list[i].input, "utf8", co);
        if (err) {
            con.warn("Can't read " + list[i].input + ".");
        } else {
            var [err, table] = yield fmt.deserialize(input, co);
            if (err) {
                con.warn("Can't deserialize JSON-formatted input from " + list[i].input + ".");
                con.warn(err.message);
            } else {
                var [err, buffer] = yield fmt.encode(table, co);
                if (err) {
                    con.warn(`Can't encode JSON-formatted input from ${list[i].input}.`);
                    con.warn(err.message);
                } else {
                    var [err] = yield fs.writeFile(list[i].output, buffer, {
                        flag: fs.constants.O_WRONLY | fs.constants.O_CREAT | (!forced ? fs.constants.O_EXCL : fs.constants.O_TRUNC)
                    }, co);
                    if (err) {
                        if (err.code == "EEXIST") {
                            con.warn("Output already exists, specify -f to overwrite.");
                        } else {
                            con.warn(`Can't write output file ${list[i].output}.`);
                        }
                    }
                }
            }
        }
    }
}

var decode_mode = function* (co, con, forced, list) {
    for (var i = 0; i < list.length; i++){
        con.log("TBL->JSON " + list[i].input);
        var [err, input] = yield fs.readFile(list[i].input, co);
        if (err) {
            con.warn("Can't read " + list[i].input + ".");
        } else {
            var [err, table] = yield fmt.decode(input, co);
            if (err) {
                con.warn("Can't decode TBL file from " + list[i].input + ".");
                con.warn(err.message);
            } else {
                var [err, buffer] = yield fmt.serialize(table, co);
                if (err) {
                    con.warn(`Can't serialize TBL input from ${list[i].input}.`);
                    con.warn(err.message);
                } else {
                    var [err] = yield fs.writeFile(list[i].output, buffer, {
                        encoding: "utf8",
                        flag: fs.constants.O_WRONLY | fs.constants.O_CREAT | (!forced ? fs.constants.O_EXCL : fs.constants.O_TRUNC)
                    }, co);
                    if (err) {
                        if (err.code == "EEXIST") {
                            con.warn("Output already exists, specify -f to overwrite.");
                        } else {
                            con.warn(`Can't write output file ${list[i].output}.`);
                        }
                    }
                }
            }
        }
    }
}

var replace_ext = function(file, dstext) {
    let ext = path.extname(file);
    if (ext) {
        return file.substr(0, file.length - ext.length) + "." + dstext;
    }
    return file + "." + dstext;
}