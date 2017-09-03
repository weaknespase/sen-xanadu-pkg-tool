# toxana-tkit

A set of various tools handy in hacking some Vita games resources.

Supported games:
* Tokyo Xanadu (Falcom)
    * tx-pkgarg - archive utility, creates and extracts PKG files
    * tx-tblconv - proprietary spreadsheet format converter (to and from JSON)
* Utawarerumono (Mask of Deception)
    * ut-pckarc - archive utility, creates and extracts PCK(SDAT) files
    * ut-fileconv - texture (TEX) and font (FNT) file format converter (limited texture support, only unpacks raw data)
        (Automatic format recognition)

## Requirements

* Node.JS 6 or later.

## Installation

    npm i -g git+https://github.com/weaknespase/toxana-tkit.git

## Usage

All tools usable from command line and contain short in-built usage message. Execute with `-h` to get help.
Only `*` glob supported at the moment.

All files inside `lib` subdirectory desinged to be usable as standalone Node.JS modules, and can be freely used as scripting addons or as parts of other projects.

# tx-pkgarc

## Examples

Unpacks contents of `foo.pkg` into `out` directory:

    tx-pkgarc unpack -o out foo.pkg
    
Unpacks contents of several packages into respective folders inside 'out' directory:

    tx-pkgarc unpack -o out foo.pkg bar.pkg

Packs contents of `bar` directory and `bar.foo` file in `foo.pkg`:

    tx-pkgarc pack -o foo.pkg bar bar.foo

Packs contents of `bar` directory in `foo.pkg` using compression:

    tx-pkgarc pack -co foo.pkg bar

Other archivers follow similar usage pattern.

# tx-tblconv

Converts *.TBL binary files into JSON and back. Uses external type definition files to map binary blobs to more human-readable data types.
By default bundled with built-in configuration for Tokyo Xanadu, it would be used if no external configuration provided.

## Examples

Convert Tokyo Xanadu TBL file(s) to JSON: (add -f to overwrite files in output directory)

    tx-tblconv decode -o decoded.json text\foobar.tbl
    tx-tblconv decode -o decoded-text text\*.tbl

Convert JSON representations back:

    tx-tblconv encode -o text\foobar.tbl decoded.json
    tx-tblconv encode -o text decoded-text\*.tbl

Other converters follow similar usage pattern.

# License
<a href="http://www.apache.org/licenses/LICENSE-2.0">Apache License, Version 2.0</a>
