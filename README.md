This repository is a sort of "plugin" for [denovogear](https://github.com/denovogear/denovogear).
It adds the `mutmap` command to `dng`, which allows the generation of an HTML
file which contains an interactive visualization.

The word "mutmap" is short for "mutation map". The intent of this tool is to
help visualize ("map") the locations of mutations in a pedigree.

# Installation

Copy everything in this repository (except this README file) into the
root of your denovogear repository.

You also need to add the following line to `src/CMakeLists.txt`:

```
add_subdirectory(mutmap)
```

There are also some runtime dependencies. You'll need to have R installed
(specifically the `Rscript` command), along with the R libraries listed in
`src/mutmap/tools/install_r_dependencies.R`.

Once everything is in place, rebuild and install denovogear. You should now
have the `dng mutmap` command available.

# Running

You need 2 things to generate the visualization file:

1. A VCF file as output from a denovogear run
2. A corresponding ped file for the pedigree matching the VCF

Then you can run something like the following:

```
dng mutmap -p PED_FILE.ped -d DNG_OUTPUT_FILE.vcf -o mutmap.html
```

You should then be able to open the mutmap.html file in any modern browser to
see the visualization. Note that currently the entire contents of the VCF file
is included in the HTML file, so it can be quite large and take a bit of time
to load, especially if you host the HTML file over the internet. This has
only been tested with a ~20MiB file so far.
