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
 *  Terminal emulator helper module, extends default console interface using few ANSI control chars.
 *  Disables all extensions if output is redirected.
 */

const process = require("process");
const util = require("util");
const endpoint = process.stderr;
const ansi = endpoint.isTTY;
var colors = true;

const CSI = "\u001b[";
const ansiBright = 60;
const ansiBg = 10;
const ansiColors = {
    black: 30,
    red: 31, 
    green: 32,
    yellow: 33,
    blue: 34,
    magenta: 35,
    cyan: 36,
    white: 37
}

module.exports.log = function(text, error) {
    endpoint.write(convert(text) + "\n");
    if (error && error instanceof Error) {
        endpoint.write(util.inspect(error));
    }
}

module.exports.print = function(text) {
    endpoint.write(convert(text));
}

module.exports.printBold = function(text) {
    endpoint.write(ansiSGR(1) + convert(text) + ansiSGR());
}

module.exports.error = function(text) {
    endpoint.write(ansiSGR(ansiColors.red + ansiBright) + "Error: " + ansiSGR() + text + "\n");
}

module.exports.warn = function(text) {
    endpoint.write(ansiSGR(ansiColors.yellow + ansiBright) +
        "Warning: " + ansiSGR() + text + "\n");
}

module.exports.erase = function() {
    endpoint.write(ansiED(2));
}

module.exports.eraseLine = function() {
    endpoint.write(ansiEL(2));
}

module.exports.previousLine = function() {
    endpoint.write(ansiCPL(1) + ansiCHA(0));
}

module.exports.columns = 80;
Object.defineProperty(module.exports, "columns", {
    enumerable: true,
    get: function() {
        return ansi ? endpoint.columns : 80;
    }
});

module.exports.rows = 25;
Object.defineProperty(module.exports, "rows", {
    enumerable: true,
    get: function() {
        return ansi ? endpoint.rows : 25;
    }
});

module.exports.enableColor = function() {
    colors = true;
}

module.exports.disableColor = function() {
    colors = false;
}

function convert(value) {
    if (typeof value == "string") {
        return value;
    } else if (typeof value == "object") {
        return util.inspect(value);
    }
    return new String(value);
}

function ansiCHA(param) {
    return ansi ? CSI + param + "G" : "";
}
function ansiED(param) {
    return ansi ? CSI + param + "J" : "\n";
}
function ansiEL(param) {
    return ansi ? CSI + param + "K" : "\n";
}
function ansiCPL(param) {
    return ansi ? CSI + param + "F" : "";
}
function ansiSGR(...params) {
    return ansi && colors ? CSI + params.join(";") + "m" : "";
}
