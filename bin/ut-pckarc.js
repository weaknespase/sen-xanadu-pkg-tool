#!/usr/bin/env node

var fs = require("fs");
var path = require("path");
var cliapp = require("../lib/cliapp");
var fmt = require("../lib/fmtpck");
var u = require("../lib/util");

new cliapp.App({
    "banner": "ut-pckarc - Archive tool for PCK(SDAT) files from Utawarerumon (InK & FnH) assets.",
    "name": "ut-pckarc",
    "arguments": [
        cliapp.defParam("action", "\npack - Packs files into SDAT file\nunpack - Extracts files from SDAT"),
        cliapp.defSwitch("f", "Overwrite existing file(s)"),
        cliapp.defSwitch("v", "Print more information"),
        cliapp.defSwitch("o", "Specify output directory or file, current directory by default", "output", "output", ""),
        cliapp.defParam("file", "input files", "*inputfiles")
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

        //Validate options
        if (options.file.length == 0) errorExit("No files to process.", 1);

        var [err, stats] = yield fs.stat(options.o, co);
        if (err) {
            if (err.code == "ENOENT") {
                options.ocreate = true;
            } else errorExit("Output access error.");
        } else {
            options.odir = stats.isDirectory();
        }
        if (options.action == "pack") {
            yield* pack_mode(co, con, options);
        } else if (options.action = "unpack") {
            yield* unpack_mode(co, con, options);
        }
    }
});

var pack_mode = function* (co, con, options) {
    //All must be packed to the single file
    var output = options.o;
    if (!options.ocreate && options.odir) {
        output = path.join(output, "file.pkg");
        con.log("Output file: " + output);
        //Retest output
        var [err, stats] = yield fs.stat(output, co);
        if (err) {
            if (err.code == "ENOENT") {
                output.ocreate = true;
                output.odir = false;
            } else {
                con.error("Output access error.");
                con.error(err.message);
                process.exit(1);
            }
        } else {
            output.odir = stats.isDirectory();
            if (output.odir) {
                con.error("Output exists as directory, can't create output file.");
                process.exit(4);
            }
        }
    }

    //Test output existence
    if (!(options.ocreate | options.f)) {
        con.error("Output already exists, use -f to overwrite.");
        process.exit(4);
    }

    var input = options.file;
    var pkg = new fmt.Package(output, "w");
    pkg.on("error", co);
    pkg.on("ready", co);
    var [err] = yield;
    if (err) {
        con.error("Error occurred when packing data.");
        process.exit(4);
    }
    [err] = yield pkg.writeHeader(input.map(function(v) { return path.basename(v) }), co);
    if (err) {
        con.error("Error occurred when packing data.");
        process.exit(4);
    }
    for (var i = 0; i < input.length; i++){
        if (options.v) con.log("Packing " + path.basename(input[i]) + " into " + output + "...");
        [err] = yield pkg.writeFile(path.basename(input[i]), fs.createReadStream(input[i]), co);
        //This one doesn't support compression, unlike PKGs from TX
        if (err) {
            con.error("IO error occurred.");
            con.error(err);
            process.exit(4);
        }
    }

    yield pkg.close(co);
}

var unpack_mode = function* (co, con, options) {
    //All must go into directory
    var output = options.o;
    if (!(options.ocreate | options.odir)) {
        con.error("Output exists as file, can't create output directory.");
        process.exit(4);
    } else {
        if (options.ocreate) {
            var [err] = yield fs.mkdir(output, co);
            if (err) {
                if (err.code != "EEXIST") {
                    con.error("Can't create output directory.");
                    con.error(err.message);
                    process.exit(4);
                }
            }
        }
    }

    var input = options.file;
    var multimode = input.length > 1;
    while (input.length > 0) {
        var file = input.shift();
        var pkg = new fmt.Package(file, "r");
        pkg.on("load", co);
        pkg.on("error", co);
        var [err] = yield;
        if (err){
            if (err.code == "ENOENT") {
                con.warn("File not found: " + file + ".");
            } else if (err.code == "EBUSY") {
                con.warn("File '" + file + "' is opened by another process.");
            } else {
                con.warn("Invalid PKG file: " + file);
                con.warn(err);
            }
        } else {
            let dir = output;
            if (multimode) {
                dir = path.join(output, u.stripExt(path.basename(file)));
                var [err] = yield fs.mkdir(dir, co);
                if (err) {
                    if (err.code != "EEXIST") {
                        con.warn("Can't create output directory for package: " + file);
                        con.warn(err.message);
                        continue;
                    }
                }
            }
            for (var i = 0; i < pkg.files.length; i++){
                if (options.v) con.log("Extracting " + path.basename(file) + " -> " + pkg.files[i].name + " [" + u.formatSize(pkg.files[i]._size) + "]...");
                let os = fs.createWriteStream(path.join(dir, pkg.files[i].name), {
                    flags: fs.constants.O_WRONLY | fs.constants.O_CREAT | (options.f ? fs.constants.O_TRUNC : fs.constants.O_EXCL)
                });
                pkg.files[i].createReadStream().pipe(os);
                os.on("close", co);
                os.on("error", co);
                //Wait for stream to finish
                var [err] = yield;
                if (err) {
                    if (err.code == "EEXIST") {
                        con.warn("File " + path.join(dir, pkg.files[i].name) + " already exists, use -f to overwrite.");
                    } else {
                        con.warn("Error occurred while extracting file.");
                        con.warn(err.message);
                    }
                }
                if (os.bytesWritten != pkg.files[i]._size) con.warn("Output size doesn't match header!");
            }
        }
    }
}