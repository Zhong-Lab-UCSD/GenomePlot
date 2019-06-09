/**
 * @file
 * Create a genome-wide plot for BED data
 * Basic workflow:
 * *   Parse input arguments
 * *   Read cytoBandIdeo / chromSizes to determine the chromosome structure
 * *   Calculate the size of each chromosome
 *     *   Stack chromosomes if needed
 * *   Calculate the size of the final output, build the main `<svg>` element
 * *   Rasterize every chromosome with scale
 * *   Read BED data and put them into the rasters
 * *   Draw every chromosome
 *     *   Create the sub-`<svg>` element at the correct location
 *     *   Draw rasterized BED data on the chromosome
 *     *   Draw cytoband ideogram (if any) of the chromosome
 *     *   Create chromosomal label **outside** the sub-`<svg>` element
 * *   Write the main `<svg>` element to file
 * @version 0.1.0
 */

const program = require('commander')
const genomePlot = require('./genomePlot')

/**
 * Parse input arguments
 */

function list (value) {
  return value.trim().split(',')
}

program
  .version('0.1.0', '-v, --version')
  .usage('[options] <bedFiles ...>')
  .option('-c, --chrom-sizes <file>',
    'A file in UCSC chrom.sizes format')
  .option('-i, --cytoband-ideo <file>',
    'A file in UCSC cytobandIdeo format')
  .option('-l, --labels <labelList>',
    'A list of labels to be used in the figure, separated by comma(,).', list)
  .option('-t, --stacked',
    'Whether stack chromosomes together to create a shorted result. ' +
    'Numbered chromosomes will be complimentarily stacked ' +
    'and sex chromosomes will be separated stacked.')
  .option('-s, --scale <n>',
    'Horizontal scale (in number of bps per point). ' +
    'Note that this will become the smallest distinguishable feature ' +
    'in the final output.',
    val => parseInt(val), 100000)
  .option('-b, --with-borders',
    'Add borders to data entries. This will make tiny data more visible at ' +
    'the expense of resolution and fidelity.')
  .option('-e, --height <height>', 'Vertical height for every dataset.',
    val => parseFloat(val), 5)
  .option('-y, --cytoband-height <cytobandHeight>',
    'Vertical height for cytoband ideograms', val => parseFloat(val), 10)
  .option('-r, --chromosome-bar-height <cytobandHeight>',
    'Vertical height for chromosome bar (if no cytoband ideogram is drawn',
    val => parseFloat(val), 1)
  .option('-G, --gap <gap>',
    'Vertical gap between chromosomes', val => parseFloat(val), 15)
  .option('-g, --in-gap <inGap>',
    'Vertical gap between datasets within a chromosome.',
    val => parseFloat(val), 2)
  .option('-z, --horizontal-gap <horiGap>',
    'Minimal horizontal gap when stacking chromosomes',
    val => parseFloat(val), 50)
  .option('-x, --text-size <textSize>',
    'Size of the text in the labels (px)', val => parseFloat(val), 16)
  .option('-p, --text-gap <textGap>',
    'Minimal horizontal gap between text and the figure',
    val => parseFloat(val), 10)
  .option('-N, --include-non-regular',
    'Include the chromosomes that are not regular ' +
    '("chrUn", alternatives, etc.)')
  .option('-M, --include-mito', 'Include the mitochondrial chromosome "chrM"')
  .parse(process.argv)

/**
 * Read cytoBandIdeo / chromSizes to determine the chromosome structure
 */

if (!process.argv.slice(2).length || !program.args.length ||
  (!program.chromSizes && !program.cytobandIdeo)) {
  console.log('Please specify BED data files and either chromosomal size ' +
    'information or cytoband ideogram information!')
  program.outputHelp()
  process.exit(1)
}

program.labels = program.labels || program.args

genomePlot.createGenomePlot(program).then(result => {
  process.stdout.write(result)
})
