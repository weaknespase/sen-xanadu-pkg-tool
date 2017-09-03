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
 *  Command-line interface application framework.
 *  Complete with automated argument parsing, help message builder and glob support.
 */

var path = require("path");
var co = require("./co");
var con = require("./ansiconsole");
var u = require("./util");
var input = require("./input");
con.disableColor();

/**
 * CLI Application class. Provide implementation of required methods to complete valid application
 * with text-based interface, glob support, automatic arguments parsing and other benefits.
 */
class CLIApplication{
    constructor(impl) {
        this._impl = impl || example_implementation_iterface();
        this._help = "";
        process.nextTick(this.__run.bind(this));
    };
    __run() {
        if (this._impl.banner) con.log(this._impl.banner);
        co(this.__parseArguments, this);
    };
    __run2(opts) {
        if (opts.h) {
            con.log(this._help);
        } else {
            co(this._impl.main, con, opts);
        }
    };
    
}
CLIApplication.prototype.__parseArguments = function* (co, self) {
    //Collect arguments from implemnetation
    var flags = Object.create(null);
    var positional = [];
    var options = Object.create(null);
    options.h = false;

    self._help = "\nUsage:\n" + u.strexp(" ", 4) + self._impl.name;
    var hm = "";
    var fcm = 1;
    for (var i = 0; i < self._impl.arguments.length; i++) {
        let arg = self._impl.arguments[i];
        if ((arg.type & 0xff) == CLIParam.prototype.TYPE_SWITCH) {
            if (arg.name == "-" || arg.name == "h") {
                throw new Error("Unable to rederine built-in flag '" + arg.name + "'.");
            } else {
                if (fcm < 0) self._help += "]";
                if (fcm != 0) {
                    self._help += " [-";
                    fcm = 0;
                }
                flags[arg.name] = arg;

                if (arg.name.length > 1) {
                    self._help += "-" + arg.name;
                    fcm = -1;
                } else {
                    //Compact switcheroo
                    self._help += arg.name;
                }
                if (arg.vtype != "boolean") {
                    let vd = arg.vdesc || arg.vtype;
                    if (arg.vdef != undefined && (typeof arg.vdef != "string" || arg.vdef.length > 0)) {
                        //Optional param
                        self._help += " " + vd + "=" + arg.vdef + "";
                    } else {
                        self._help += " " + vd;
                    }
                    fcm = -1;
                }
                if (arg.vdef != undefined) {
                    options[arg.name] = arg.vdef;
                }
                hm += CLIParam.prototype.toHelpString.call(arg, 1) + "\n";
            }
        } else {
            if (positional.length > 0) {
                if (positional[positional.length - 1].type & CLIParam.prototype.TYPE_REPEATABLE) {
                    throw new Error("Array parameter must be last.");
                } else if ((positional[positional.length - 1].type & CLIParam.prototype.TYPE_OPTIONAL) &&
                    !(arg.type & CLIParam.TYPE_OPTIONAL)) {
                    throw new Error("Non optional parameter must come before optional (" + arg.name + ").");
                }
            }
            positional.push(arg);
            if (fcm < 0) self._help += "]";
            if (fcm == 0) {
                self._help += "]";
                fcm = 1;
            }
            if (arg.type & CLIParam.prototype.TYPE_REPEATABLE) {
                options[arg.name] = [];
                if (arg.vdef != undefined) {
                    options[arg.name].push(arg.vdef);
                    self._help += " [" + arg.name + "...]";
                } else
                    self._help += " " + arg.name + "... ";
            } else {
                if (arg.vdef != undefined) {
                    options[arg.name] = arg.vdef;
                    self._help += " [" + arg.name + "]";
                } else
                    self._help += " " + arg.name;
            }
            hm += CLIParam.prototype.toHelpString.call(arg, 1) + "\n";
        }
    }
    self._help += "\n\nParameters:\n" + hm;

    var flagsAvail = true;
    var pos = 0;
    for (var i = 2; i < process.argv.length; i++) {
        let arg = process.argv[i];
        if (flagsAvail && arg == "--") {
            flagsAvail = false;
        } else {
            if (flagsAvail && arg[0] == "-") {
                //Search for flags
                if (arg[1] == "-") {
                    //Full flag, don't combine
                    let fn = arg.substr(2);
                    if (flags[fn]) {
                        if (flags[fn].vtype != "boolean") {
                            if (i + 1 < process.argv.length) {
                                options[fn] = process.argv[++i];
                            } else {
                                con.error("Missing argument value for \"" + arg + "\".");
                                process.exit(3);
                            }
                        } else {
                            options[fn] = true;
                        }
                    } else if (fn == "help") {
                        options.h = true;
                    } else {
                        con.error("Unknown flag \"" + arg + "\".");
                        process.exit(1);
                    }
                } else {
                    //Shorthands - combine
                    for (let k = 1; k < arg.length; k++) {
                        let fn = arg[k];
                        if (flags[fn]) {
                            if (flags[fn].vtype != "boolean") {
                                if (i + 1 < process.argv.length) {
                                    options[fn] = process.argv[++i];
                                    if (arg.length > k + 1) {
                                        con.error("Illegal flag combination \"" + arg + "\".");
                                        process.exit(4);
                                    }
                                } else {
                                    con.error("Missing argument value for \"-" + fn + "\".");
                                    process.exit(3);
                                }
                            } else {
                                options[fn] = true;
                            }
                        } else if (fn == "h") {
                            options.h = true;
                        } else {
                            con.error("Unknown flag \"-" + fn + "\".");
                            process.exit(1);
                        }
                    }
                }
            } else {
                //Must be positional argument
                if (positional[pos]) {
                    if (positional[pos].type & CLIParam.prototype.TYPE_REPEATABLE) {
                        if (!options[positional[pos].name])
                            options[positional[pos].name] = [];
                        options[positional[pos].name].push(arg);
                    } else {
                        options[positional[pos++].name] = arg;
                    }
                } else {
                    con.error("Too many arguments.");
                    process.exit(2);
                }
            }
        }
    }

    //Skip validation and expansion if help is asked
    if (!options.h) {
        //Validate arguments
        for (var i = 0; i < positional.length; i++) {
            if (!(positional[i].type & CLIParam.prototype.TYPE_OPTIONAL)) {
                if (positional[i].type & CLIParam.prototype.TYPE_REPEATABLE) {
                    if (options[positional[i].name].length == 0) {
                        con.error("Insufficient amount of arguments, missing " + positional[i].name);
                        process.exit(2);
                    }
                } else {
                    let to = typeof options[positional[i].name];
                    if (to == "undefined") {
                        con.error("Insufficient amount of aruments, missing " + positional[i].name);
                        process.exit(2);
                    }
                    if (positional[i].vtype == "number") {
                        options[positional[i].name] = parseFloat(options[positional[i].name]);
                        if (isNaN(options[positional[i].name])) {
                            con.error("Illegal argument value for " + positional[i].name + ": number expected.");
                            process.exit(2);
                        }
                    }
                }
            }
        }

        //Run filter from libinput over all applicable args
        for (var i in flags) {
            yield* self.__parseInputArgument(co, self, options, flags[i]);
        }
        for (var i = 0; i < positional.length; i++){
            yield* self.__parseInputArgument(co, self, options, positional[i]);
        }
    }
    self.__run2(options);
}
CLIApplication.prototype.__parseInputArgument = function* (co, self, options, def) {
    if (def.type & CLIParam.prototype.TYPE_PATH_INPUT) {
        let m = null;   
        if (def.type & CLIParam.prototype.TYPE_DIRECTORY) {
            m = function(path, stats) {
                return stats.isDirectory() == true;
            }
        }
        let [list] = yield input.list(options[def.name], {
            filterFunc: m,
            depth: (def.type & CLIParam.prototype.TYPE_UNROLL) ? Infinity : 0
        }, co);
        let x = options[def.name] = [];
        for (var k = 0; k < list.length; k++) {
            if (list[k].err) {
                //XXX List item error, possibly print
            } else {
                x.push(path.join(list[k].base, list[k].path));
            }
        }
    } else if (def.type & CLIParam.prototype.TYPE_PATH_OUTPUT) {
        //Convert paths to absolute and create output folder hierarchy
        let isdir = Boolean(def.type & CLIParam.prototype.TYPE_DIRECTORY)
        if (Array.isArray(options[def.name])) {
            let list = options[def.name];
            for (var i = 0; i < list.length; i++){
                list[i] = path.resolve(process.cwd(), list[i]);
                let dir = (isdir ? list[i] : path.dirname(list[i]));
                let [err] = yield input.mkdirs(dir, co);
                if (err) {
                    con.error("Can't create output directory " + dir + ".");
                    con.error(err.message);
                    process.exit(3);
                }
            }
        } else {
            options[def.name] = path.resolve(process.cwd(), options[def.name]);
            let dir = (isdir ? options[def.name] : path.dirname(options[def.name]));
            let [err] = yield input.mkdirs(dir, co);
            if (err) {
                con.error("Can't create output directory.");
                con.error(err.message);
                process.exit(3);
            }
        }
    }
}

class CLIParam{
    constructor(type, name, desc, vtype, vdesc, vdef) {
        this.type = type;
        this.name = name;
        this.desc = desc;
        this.vtype = vtype;
        this.vdesc = vdesc;
        this.vdef = vdef;
    };
    toHelpString(offset = 0) {
        const cols = 20;
        var pad = u.strexp(" ", offset * 4);
        var dpad = u.rpad(pad, " ", cols+1) + pad;
        switch (this.type & 0xff) {
            case 0: {
                //Switch type
                //-<flag> <value>=<default> <description>
                let out = pad + "-";
                if (this.name.length > 1) out += "-";
                out += this.name;
                let vd = (this.vtype != "boolean") ? (this.vdesc || this.vtype) : false;
                if (vd) {
                    if (this.vdef != undefined && (typeof this.vdef != "string" || this.vdef.length > 0)){
                        out += " <" + vd + "=" + this.vdef + ">";
                    } else {
                        out += " <" + vd + ">";
                    }
                }
                out = u.rpad(out, " ", cols);
                if (this.desc)
                    out += " " + this.desc.replace(/\n/g, "\n" + dpad);
                return out;
            }    
            case 1: {
                //Param type
                //<name> <description>
                let out = pad;
                let r = this.type & this.TYPE_REPEATABLE;
                if (this.type & this.TYPE_OPTIONAL) {
                    if (this.vdef != undefined) {
                        if (r)
                            out += "[" + this.name + "[]=[" + this.vdef + "]]";
                        else 
                            out += "[" + this.name + "=" + this.vdef + "]";
                    } else {
                        if (r)
                            out += "[" + this.name + "[]]";
                        else 
                            out += "[" + this.name + "]";
                    }    
                } else {
                    if (r)
                        out += "<" + this.name + "[]>";
                    else 
                        out += "<" + this.name + ">";
                }
                out = u.rpad(out, " ", cols);
                if (this.desc)
                    out += " " + this.desc.replace(/\n/g, "\n" + dpad);
                return out;
            }    
            default:
                throw new Error("Unknown type of parameter " + (this.type & 0xff));
        }
    }
}
CLIParam.prototype.TYPE_SWITCH      = 0x0;
CLIParam.prototype.TYPE_PARAM       = 0x1;
CLIParam.prototype.TYPE_REPEATABLE  = 0x100;
CLIParam.prototype.TYPE_PATH_INPUT  = 0x200;
CLIParam.prototype.TYPE_PATH_OUTPUT = 0x400;
CLIParam.prototype.TYPE_DIRECTORY   = 0x10000;
CLIParam.prototype.TYPE_UNROLL      = 0x20000;
CLIParam.prototype.TYPE_OPTIONAL    = 0x8000000;

module.exports.App = CLIApplication;
module.exports.defSwitch = function(flag, desc, type, tdesc, vdef) {
    let vt = CLIParam.prototype.TYPE_SWITCH;
    switch (type) {
        case "string":
        case "number":
            break;    
        case "boolean":  
            vdef = false;    
            break;
        case "input":
            type = "string";
            vt |= CLIParam.prototype.TYPE_PATH_INPUT;
            break;    
        case "inputdir":
            type = "string";
            vt |= CLIParam.prototype.TYPE_PATH_INPUT | CLIParam.prototype.TYPE_DIRECTORY;
            break;
        case "inputfiles":
            type = "string";
            vt |= CLIParam.prototype.TYPE_PATH_INPUT | CLIParam.prototype.TYPE_UNROLL;
            break;
        case "output":
            type = "string";
            vt |= CLIParam.prototype.TYPE_PATH_OUTPUT;
            break;
        case "outputdir":
            type = "string";
            vt |= CLIParam.prototype.TYPE_PATH_OUTPUT | CLIParam.prototype.TYPE_DIRECTORY;
            break;
        default:
            type = "boolean";
    }
    desc = desc || "";
    tdesc = tdesc || "";
    return new CLIParam(vt, flag, desc, type, tdesc, vdef);
}
module.exports.defParam = function(name, desc, type, vdef) {
    let vt = CLIParam.prototype.TYPE_PARAM;
    let r = type != undefined && type[0] == "*";
    if (r) {
        type = type.substr(1);
        vt |= CLIParam.prototype.TYPE_REPEATABLE;
    }
    switch (type) {
        case "string":
        case "number":
            break;
        case "input":
            type = "string";
            vt |= CLIParam.prototype.TYPE_PATH_INPUT;
            break;    
        case "inputdir":
            type = "string";
            vt |= CLIParam.prototype.TYPE_PATH_INPUT | CLIParam.prototype.TYPE_DIRECTORY;
            break;
        case "inputfiles":
            type = "string";
            vt |= CLIParam.prototype.TYPE_PATH_INPUT | CLIParam.prototype.TYPE_UNROLL;
            break;
        case "output":
            type = "string";
            vt |= CLIParam.prototype.TYPE_PATH_OUTPUT;
            break;
        case "outputdir":
            type = "string";
            vt |= CLIParam.prototype.TYPE_PATH_OUTPUT | CLIParam.prototype.TYPE_DIRECTORY;
            break;
        default:
            type = "string";
    }
    desc = desc || "";
    if (vdef != undefined)
        vt |= CLIParam.prototype.TYPE_OPTIONAL;
    return new CLIParam(vt, name, desc, type, null, vdef);
}