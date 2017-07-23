# sen-xanadu-pkg-tool
Simple tool able to unpack or pack again files in format of PKG files used by Tokyo Xanadu and Sen no Kiseki games.

Requires fresh (>6.0) node.js framework.

## Usage
To extract files:

    node pkg_tool.js unpack [-v] [-o directory] [--] input

where `input` is space-delimited list of package files.

To pack files back:

    node pkg_tool.js pack [-vfcc] [-o file] [--] file1 file2 ... fileN

where `fileN` also can be a directory, in that case all files from this directory will be packed (but not from subdirectories).

    -f      Overwrite output file.
    -v      Show progress.
    -c      Compress files, once for fast compression, two for full compression, three to additionally enable mixed mode.
    -o      Specify output file/directory.

## Examples

Unpacks contents of book.pkg into `out` directory:

    node pkg_tool.js unpack -vo out foo.pkg
    
Unpacks contents of several packages into respective folders inside 'out' directory:

    node pkg_tool.js unpack -vo out foo.pkg bar.pkg

Packs contents of `bar` directory and `bar.foo` file in `foo.pkg`:

    node pkg_tool.js pack -vo foo.pkg bar bar.foo

Packs contents of `bar` directory in `foo.pkg` with full compression:

    node pkg_tool.js pack -vcco foo.pkg bar

# xanadu-tbl-codec
Converts *.TBL binary files into JSON and back.
Together with script bundled somewhat filled configuration file for Tokyo Xanadu, named `xanadu_tlbs.conf`.

## Usage
Convert TBL to JSON:

    node tbl_codec.js decode [-fv] [-t config] [-o dir] file1 file2 ... fileN
    
Convert JSON back to TBL:

    node tbl_codec.js encode [-fv] [-o dir] file1 file2 ... fileN

Options:

    -f      Overwrite output files.
    -v      Show progress.
    -t      Specify configuration file with types data. Used to map binary payload to human-readable data types.
    -o      Specify output directory for files, by default files placed in same directory as source files.
