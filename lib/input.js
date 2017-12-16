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
 *  Glob support library (and few other unrelated bits)
 */

var fs = require("fs");
var path = require("path");
var co = require("./co");

var anyFilter = function() {
    return true;
}

function prepareOptions(options) {
    var opts = (typeof options == "object" ? options : {});
    if (opts == null) opts = {};
    if (typeof options == "function") opts.filterFunc = options; else opts.filterFunc = anyFilter;
    if (typeof opts.depth != "number") opts.depth = 0;
    return opts;
}

function* descend(co, dir, base, depth, filterFunc) {
    var out = [];
    var [err, list] = yield fs.readdir(path.join(base, dir), co);
    if (err) {
        return out;
    } else {
        for (var i = 0; i < list.length; i++){
            let loc = path.join(base, dir, list[i]);
            let [err, stats] = yield fs.stat(loc, co);
            if (err) {
                out.push({
                    err: err,
                    path: path.join(dir, list[i]),
                    base: base
                });
            } else {
                if (stats.isDirectory()) {
                    if (depth > 0) {
                        out.push.apply(out, yield* descend(co, path.join(dir, list[i]), base, depth - 1));
                    }
                }
                if (filterFunc(loc, stats)) {
                    out.push({
                        err: null,
                        path: path.join(dir, list[i]),
                        base: base
                    });
                }
            }
        }
    }
    return out;
}

function* filterInputs(co, list, options, callback) {
    //For all inputs, perform input parsing from top to bottom, match globs and construct list of input files in format
    // { basedir: "<dir>", path: "<path>", err: Error}
    options = prepareOptions(options);

    var out = [];
    for (var i = 0; i < list.length; i++){
        let [err, stats] = yield fs.stat(list[i], co);
        if (err) {
            //Treat as glob
            let parts = list[i].split(path.sep);
            let acc = "";
            let sub = [];
            for (let j = 0; j < parts.length; j++){
                if (parts[j].indexOf("*") > -1) {
                    let pattern = new RegExp("^" + parts[j].replace(/\*/g, ".*") + "$", "i");
                    let tail = parts.slice(j + 1).join(path.sep);
                    let [err, files] = yield fs.readdir(acc.length == 0 ? "." : acc, co);
                    if (err) {
                        break;
                    } else {
                        for (let k = 0; k < files.length; k++){
                            if (pattern.test(files[k])) {
                                sub.push(path.join(acc, files[k], tail));
                            }
                        }
                        list = sub.concat(list.slice(i + 1));
                        i = -1;
                        break;
                    }
                } else {
                    if (!acc) acc = parts[j]; else acc = path.join(acc, parts[j]);
                }
            }
        } else {
            if (stats.isDirectory()) {
                if (options.depth > 0) {
                    out.push.apply(out, yield* descend(co, path.basename(list[i]), path.dirname(list[i]), options.depth - 1, options.filterFunc));
                }
            }
            if (options.filterFunc(list[i], stats)) {
                out.push({
                    err: null,
                    path: path.basename(list[i]),
                    base: path.dirname(list[i])
                });
            }
        }
    }
    callback(out);
}

function* mkdirs(co, dir, callback) {
    var [err] = yield fs.mkdir(dir, co);
    if (err) {
        if (err.code == "EEXIST") {
            //Do nothing
        } else if (err.code == "ENOENT") {
            yield* mkdirs(co, path.dirname(dir));
            var [err] = yield fs.mkdir(dir, co);
            callback(err);
        } else {
            callback(err);
        }
    }
    callback();
}

/**
 * Lists files expanding globs.
 * @param {string[]} list list of input files
 * @param {function(string, Stats):boolean|{filterFunc: (path: string, stats : Stats) => boolean, depth: number}} options search options
 * @param {function({err: Error, path: string}[])} callback
 */
module.exports.list = function(list, options, callback) {
    co(filterInputs, list, options, callback);
}

module.exports.mkdirs = function(dpath, callback) {
    co(mkdirs, dpath, callback);
}