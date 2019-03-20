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

const fs = require('fs')
const util = require('util')
const readFilePromise = util.promisify(fs.readFile)

const jsdom = require('jsdom')
const ChromRegion = require('@givengine/chrom-region')
const d3 = require('d3')
const program = require('commander')

var chromosomes = []
chromosomes.map = {}

/**
 * @class Chromosome
 * @extends ChromRegion
 */
class Chromosome extends ChromRegion {
  constructor (name, size) {
    super({
      chr: name,
      start: 0,
      end: size,
      name: name
    }, null, {
      cytobands: []
    })
  }

  addCytoband (cytoband) {
    if (cytoband) {
      this.cytobands.push(cytoband)
    }
    if (this.end < cytoband.end) {
      this.end = cytoband.end
    }
    this.cytobands.sort(ChromRegion.compare)
  }

  get isNumbered () {
    return this.name.match(/chr[0-9]+/i)
  }

  get isRegular () {
    return !this.name.match(/(chrUn)|_|(chrM)/)
  }

  get isMitochondrial () {
    return this.name.match(/^chrM$/i)
  }
}

/**
 * Parse a chrom.sizes file and return a list of chromosomes
 *
 * chrom.sizes will be a delimited file with the following columns:
 * *   `name`: chromosomal name
 * *   `size`: chromosome size
 * @param {string} fileContent - Chrom size file content
 * @param {Array<Chromosome>} chromosomes - chromosome array (with a map)
 * @returns {Array<Chromosome>} The result set of chromosomes
 */
function parseChromSizeFile (fileContent, chromosomes) {
  fileContent.trim().split('\n').forEach(line => {
    let tokens = line.trim().split(/\s+/)
    if (!chromosomes.map.hasOwnProperty(tokens[0])) {
      let newChrom = new Chromosome(tokens[0], parseInt(tokens[1]))
      chromosomes.push(newChrom)
      chromosomes.map[newChrom.name] = newChrom
    }
  })
  return chromosomes
}

/**
 * Parse a cytobandIdeo file and return a list of chromosomes
 *
 * CytobandIdeo files will be a delimited file with the following columns:
 * *   `chrom`: chromosomal name
 * *   `chromStart`: start coordinate
 * *   `chromEnd`: end coordinate
 * *   `name`: name of the band
 * *   `gieStain`: one of the following:
 *     *   `gneg`: negative Giemsa stain (interband)
 *     *   `gpos25`: 25% Giemsa stain
 *     *   `gpos50`: 50% Giemsa stain
 *     *   `gpos75`: 75% Giemsa stain
 *     *   `gpos100`: 100% Giemsa stain
 *     *   `acen`: centromere
 *     *   `gvar`: chromosomal structural element
 *     *   `stalk`: chromosome arm
 * @param {string} fileContent - CytobandIdeo file content
 * @param {Array<Chromosome>} chromosomes - chromosome array (with a map)
 * @returns {Array<Chromosome>} The result set of chromosomes
 */
function parseCytobandIdeoFile (fileContent, chromosomes) {
  fileContent.trim().split('\n').forEach(line => {
    let tokens = line.trim().split(/\s+/)
    let cytoband = new ChromRegion({
      chr: tokens[0],
      start: parseInt(tokens[1]),
      end: parseInt(tokens[2]),
      name: tokens[3]
    }, null, {
      gieStain: tokens[4]
    })
    if (!chromosomes.map.hasOwnProperty(tokens[0])) {
      let newChrom = new Chromosome(tokens[0], parseInt(tokens[2]))
      chromosomes.push(newChrom)
      chromosomes.map[newChrom.name] = newChrom
    }
    chromosomes.map[tokens[0]].addCytoband(cytoband)
  })
  return chromosomes
}

/**
 * Parse input arguments
 */

program
  .version('0.1.0', '-v, --version')
  .usage('[options] <bedFiles ...>')
  .option('-c, --chrom-sizes <file>',
    'A file in UCSC chrom.sizes format')
  .option('-i, --cytoband-ideo <file>',
    'A file in UCSC cytoBandIdeo format')
  .option('-t, --stacked',
    'Whether stack chromosomes together to create a shorted result. ' +
    'Numbered chromosomes will be complimentarily stacked ' +
    'and sex chromosomes will be separated stacked.')
  .option('-s, --scale <n>',
    'Horizontal scale (in number of bps per point). ' +
    'Note that this will become the smallest distinguishable feature ' +
    'in the final output.',
    parseInt, 100000)
  .option('-b, --with-borders',
    'Add borders to data entries. This will make tiny data more visible at ' +
    'the expense of resolution and fidelity.')
  .option('-h, --height <height>', 'Vertical height for every dataset.',
    parseFloat, 5)
  .option('--cytoband-height <cytobandHeight>',
    'Vertical height for cytoband ideograms', parseFloat, 10)
  .option('-G, --gap <gap>',
    'Vertical gap between chromosomes', parseFloat, 15)
  .option('-g, --in-gap <inGap>',
    'Vertical gap between datasets within a chromosome.', parseFloat, 0.5)
  .option('--horizontal-gap <horiGap>',
    'Minimal horizontal gap when stacking chromosomes', parseFloat, 50)
  .option('--text-size <textSize>',
    'Size of the text in the labels', parseFloat, 16)
  .option('--text-gap <textGap>',
    'Minimal horizontal gap between text and the figure', parseFloat, 10)
  .option('--include-non-regular',
    'Include the chromosomes that are not regular ' +
    '("chrUn", alternatives, etc.)')
  .option('--include-mito', 'Include the mitochondrial chromosome "chrM"')
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

var readChromInfoPromise

if (program.chromSizes) {
  readChromInfoPromise = readFilePromise(program.chromSizes, 'utf8')
    .then(result => (chromosomes = parseChromSizeFile(result, chromosomes)))
} else {
  readChromInfoPromise = readFilePromise(program.cytobandIdeo, 'utf8')
    .then(result => (chromosomes = parseCytobandIdeoFile(result, chromosomes)))
}

/**
 * *   Calculate the size of each chromosome
 *     *   Stack chromosomes if needed
 */

const document = jsdom.jsdom()
const svg = d3.select(document.body).append('svg')
