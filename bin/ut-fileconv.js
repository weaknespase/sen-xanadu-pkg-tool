#!/usr/bin/env node

var fs = require("fs");
var path = require("path");
var cliapp = require("../lib/cliapp");
var fmt = require("../lib/fmtutw");
var u = require("../lib/util");

new cliapp.App({
    "banner": "ut-fileconv - Milti-format file converter for Utawarerumono (MoD, MoT) assets.",
    "name": "ut-fileconv",
    "arguments": [
        cliapp.defParam("action", "\nencode - Encodes JSON formated data into binary file\ndecode - Decodes binary file into JSON file (with additional files depending on source file format)"),
        cliapp.defSwitch("f", "Overwrite existing file"),
        cliapp.defSwitch("v", "Print more information"),
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
        options.o = options.o || process.cwd();

        var errorExit = function(message, code) {
            con.error(message);
            process.exit(code);
        }

        //Validate some options
        if (options.file.length == 0) errorExit("No files found to convert.", 1);

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
                    list[0].output = path.join(odir, u.stripExt(path.basename(list[0].input)));
                }
            } else errorExit("Output access error.", 2);
        } else {
            if (options.file.length > 1) {
                if (!stats.isDirectory()) {
                    con.error("Output exists as file already, can't create output directory.");
                    process.exit(3);
                } else {
                    list[0].output = path.join(list[0].output, u.stripExt(path.basename(list[0].input)));
                }    
            } else if (options.file.length == 1 && stats.isDirectory()) {
                //Modify first entry to point inside exising directory
                list[0].output = path.join(list[0].output, u.stripExt(path.basename(list[0].input)));
            }
        }

        //Process other files
        for (var j = 1; j < options.file.length; j++){
            list.push({
                input: options.file[j],
                output: path.join(odir, u.stripExt(path.basename(options.file[j])))
            });
        }

        if (options.action == "encode") {
            yield* encode_mode(co, con, options.f, options.v, list);
        } else if (options.action == "decode") {
            yield* decode_mode(co, con, options.f, options.v, list);
        } else errorExit("Invalid mode specified: " + options.action + ".", 1);
    }
});

var encode_mode = function* (co, con, forced, verbose, list) {
    for (var i = 0; i < list.length; i++){
        con.log("JSON->Binary " + list[i].input);
        var [err, data] = yield fs.readFile(list[i].input, "utf8", co);
        if (err) {
            if (err.code == "ENOENT") {
                con.warn("File not found: " + list[i].input + ".");
            } else if (err.code == "EBUSY") {
                con.warn("File '" + list[i].input + "' is opened by another process.");
            } else {
                con.warn(err);
            }
        } else {
            try {
                var obj = JSON.parse(data);
                //Read all binary parts
                for (var j in obj.refs) {
                    let file = path.resolve(path.dirname(list[i].input), obj.refs[j]);
                    let [err, data] = yield fs.readFile(file, co);
                    if (err) {
                        con.warn("Can't read referenced binary file.");
                        con.warn(err);
                        continue;
                    } else {
                        obj.refs[j] = [
                            path.extname(file).substr(1),
                            data
                        ];
                    }
                }

                var mod = null;
                switch (obj.type) {
                    case "texture": {
                        if (verbose) console.log("Texture format detected.");
                        mod = fmt.TextureFile.fromJSObj(obj);
                        list[i].output = u.replaceExt(list[i].output, "tex");
                        break;
                    }    
                    case "font": {
                        if (verbose) console.log("Font format detected.");
                        mod = fmt.FontFile.fromJSObj(obj);
                        list[i].output = u.replaceExt(list[i].output, "fnt");
                        break;
                    }
                    default:
                        con.warn("Unknown type of file: " + obj.type + ".");
                }
                if (mod) {
                    let cf = new fmt.ChunkFile(list[i].output, "w");
                    cf.on("error", co);
                    cf.on("ready", co);
                    let [err] = yield;
                    if (err) {
                        con.warn("Can't write output file " + list[i].output + ".");
                        con.warn(err.message);
                    } else {
                        let [err] = yield mod.export(cf, co);
                        if (err) {
                            con.warn("Can't write output file " + list[i].output + ".");
                            con.warn(err.message);
                        }
                    }
                    yield cf.close(co);
                }
            } catch (e) {
                if (e.message.indexOf("JSON") > -1) {
                    con.warn("Invalid JSON file: " + list[i].input);
                    let pos = parseInt(/\d+/.exec(e.message)[0]);
                    con.warn(e.message + "\n\tContents around:\n" + data.substr(Math.max(0, pos - 40), 80));
                } else {
                    con.error(e.stack)
                    process.exit(-1);
                }
            }
        }

    }
}

var decode_mode = function* (co, con, forced, verbose, list) {
    for (var i = 0; i < list.length; i++){
        con.log("Binary->JSON " + list[i].input);
        var cf = new fmt.ChunkFile(list[i].input, "r");
        cf.on("error", co);
        cf.on("load", co);
        var [err] = yield;
        if (err) {
            con.warn("Can't read source file " + list[i].input + ".");
            con.warn(err.message);
            continue;
        }

        //Test all possible file types
        var mod = null;
        if (fmt.TextureFile.test(cf)) {
            if (verbose) con.log("Converting texture file...");
            let [err, tex] = yield fmt.TextureFile.fromChunkFile(cf, co);
            if (err) {
                con.warn("Failed to decode texture from source file.");
                continue;
            }
            mod = tex.export();
        } else if (fmt.FontFile.test(cf)) {
            if (verbose) con.log("Converting font file...");
            let [err, fnt] = yield fmt.FontFile.fromChunkFile(cf, co);
            if (err) {
                con.warn("Failed to decode font from source file.");
                continue;
            }
            mod = fnt.export();
        } else {
            //Skip unknown file
            if (verbose) con.log("Unknown file format detected.");
            con.warn("Unknown file format " + list[i].input + ".");
            //TODO Maybe split unkown files by chunks without further processing?
        }

        if (mod) {
            //Copy out all binary components
            let pass = true;
            for (var j in mod.refs) {
                let out = list[i].output + (mod.refs[j][0] ? "." + mod.refs[j][0] : "");
                let [err] = yield fs.writeFile(out, mod.refs[j][1], {
                    flag: fs.constants.O_WRONLY | fs.constants.O_CREAT | (forced ? fs.constants.O_TRUNC : fs.constants.O_EXCL)
                }, co);
                if (err) {
                    if (err.code == "EEXIST") {
                        con.warn("Destination file aready exists, use -f to overwrite.");
                        pass = false;
                        break;
                    } else {
                        con.warn("Can't write binary reference " + out + ".");
                        pass = false;
                        break;
                    }
                } else {
                    mod.refs[j] = path.basename(out);
                }
            }
            //Save JSON-formatted export
            if (pass) {
                let out = list[i].output + ".json";
                let [err] = yield fs.writeFile(out, JSON.stringify(mod, null, 4), {
                    flag: fs.constants.O_WRONLY | fs.constants.O_CREAT | (forced ? fs.constants.O_TRUNC : fs.constants.O_EXCL)
                }, co);
                if (err) {
                    if (err.code == "EEXIST") {
                        con.warn("Destination file aready exists, use -f to overwrite.");
                    } else {
                        con.warn("Can't write output file " + out + ".");
                    }
                }
            }
        }
    }
}
