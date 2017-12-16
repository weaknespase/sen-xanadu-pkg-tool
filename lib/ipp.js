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
 *  Format library - image format converter
 */

var crc = require("crc");
var zlib = require("zlib");

function pngCRC(buffer, start, length) {
    return crc.crc32(buffer.slice(start, start + length));
}

/**
 * @param {{width:number,height:number,palette:number[],bpp:number,pixels:Buffer}} options
 */
module.exports.mkPNG = function(options) {
    var size = options.pixels.length * 4 * 8 / options.bpp + options.height + 12 + 12 + 8 + 13 + 12; //IDAT + IHDR chunk + PNG signature + IEND
    var out = Buffer.allocUnsafe(size);
    out.writeUInt32BE(0x89504e47, 0);
    out.writeUInt32BE(0x0d0a1a0a, 4);
    out.writeUInt32BE(13, 8);
    out.writeUInt32BE(0x49484452, 12);
    out.writeUInt32BE(options.width, 16);
    out.writeUInt32BE(options.height, 20);
    out[24] = 8;
    out[25] = 6;
    out[26] = 0;
    out[27] = 0;
    out[28] = 0;
    out.writeUInt32BE(pngCRC(out, 12, 13+4), 29);
    var ptr = 33;
    
    var imageSizePtr = ptr;
    out.writeUInt32BE(0, ptr);
    ptr += 4;
    out.writeUInt32BE(0x49444154, ptr);
    ptr += 4;
    var plx = 0;
    var pls = 0;
    var inptr = 0;
    //Convert palette for faster access
    var pal = new Uint8Array(options.palette.length * 4);
    for (var i = 0; i < options.palette.length; i++){
        pal[i * 4] = options.palette[i] & 0xFF;
        pal[i * 4 + 1] = (options.palette[i] & 0xFF00) >> 8;
        pal[i * 4 + 2] = (options.palette[i] & 0xFF0000) >> 16;
        pal[i * 4 + 3] = (options.palette[i] / 0x1000000) & 0xFF;
    }
    var mask = (Math.pow(2, options.bpp) | 0) - 1;
    var shift = options.bpp;
    //Read each pixel, convert to palette entry, proceed
    for (var y = 0; y < options.height; y++){
        out[ptr++] = 0;
        for (var x = 0; x < options.width; x++){
            if (pls == 0) {
                plx = options.pixels.readUInt16LE(inptr);
                pls += 16;
                inptr += 2;
            }
            let i = (plx & mask) * 4;
            plx >>= shift;
            pls -= shift;
            out[ptr++] = pal[i++];
            out[ptr++] = pal[i++];
            out[ptr++] = pal[i++];
            out[ptr++] = pal[i++];
        }
    }

    var comp = zlib.deflateSync(out.slice(imageSizePtr + 8, ptr));
    comp.copy(out, imageSizePtr + 8);
    ptr = imageSizePtr + 8 + comp.length;
    out.writeUInt32BE(comp.length, imageSizePtr);
    out.writeUInt32BE(pngCRC(out, imageSizePtr + 4, ptr - imageSizePtr - 4), ptr);
    ptr += 4;

    //Write IEND
    out.writeUInt32BE(0, ptr);
    ptr += 4;
    out.writeUInt32BE(0x49454E44, ptr);
    ptr += 4;
    out.writeUInt32BE(pngCRC(out, ptr-4, 4), ptr);
    ptr += 4;
    return out.slice(0, ptr);
}