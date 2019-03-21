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
const { JSDOM } = jsdom
const ChromRegion = require('@givengine/chrom-region')
const d3 = require('d3')
const program = require('commander')

const colorPalette = [
  '#4477AA',
  '#66CCEE',
  '#228833',
  '#CCBB44',
  '#EE6677',
  '#AA3377'
]

var chromosomeStacks = []
var svgWidth
var textLabelWidth = [0, 0]
var svgHeight = 0
var svgEntryHeight = 0

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
      cytobands: [],
      data: {},
      centromere: null
    })
  }

  addCytoband (cytoband) {
    if (cytoband) {
      this.cytobands.push(cytoband)
      if (cytoband.gieStain === 'acen') {
        if (this.centromere) {
          this.centromere.concat(cytoband)
        } else {
          this.centromere = cytoband
        }
      }
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

  initData (label) {
    if (this.data.hasOwnProperty(label)) {
      console.warn('Data already existed for label "' + label + '".')
    } else {
      this.data[label] = []
    }
  }

  addData (label, bedEntry) {
    if (this.chr !== bedEntry.chr) {
      return
    }
    for (let i = parseInt(bedEntry.start / this.constructor.dataScale);
      i <= parseInt(bedEntry.end / this.constructor.dataScale);
      i++
    ) {
      this.data[label][i] = (this.data[label][i] || 0) + 1
    }
  }

  drawData (svgElem, label, labelIndex, params) {
    this.data[label].forEach((dataEntry, dataIndex) => {
      let svgRect = svgElem.append('rect')
        .attr('x', dataIndex)
        .attr('y', labelIndex * (params.height + params.inGap))
        .attr('width', 1)
        .attr('height', params.height)
        .attr('fill', colorPalette[labelIndex % colorPalette.length])
      if (params.withBorders) {
        svgRect.attr('stroke', colorPalette[labelIndex % colorPalette.length])
          .attr('stroke-width', 1)
      }
    })
  }

  static getCytobandColor (band) {
    switch (band.gieStain) {
      case 'gpos25':
        return '#DDDDDD'
      case 'gpos50':
        return '#BBBBBB'
      case 'gpos75':
      case 'stalk':
        return '#999999'
      case 'gpos100':
      case 'gvar':
        return '#777777'
      default:
        return '#FFFFFF'
    }
  }

  drawArm (svgElem, arm, params) {
    // Steps
    // 1. draw arms and centromere
    svgElem.append('rect')
      .attr('x', arm.start / this.constructor.dataScale)
      .attr('y', svgElem.attr('height') - params.cytobandHeight)
      .attr('width', (arm.end - arm.start) / this.constructor.dataScale)
      .attr('height', params.cytobandHeight)
      .attr('stroke', '#000000')
      .attr('stroke-width', 1)
      .attr('rx', params.cytobandHeight * 0.25)
      .attr('ry', params.cytobandHeight * 0.25)
    svgElem.append('clipPath')
      .attr('id', arm.name)
      .append('rect')
      .attr('x', arm.start / this.constructor.dataScale)
      .attr('y', svgElem.attr('height') - params.cytobandHeight)
      .attr('width', (arm.end - arm.start) / this.constructor.dataScale)
      .attr('height', params.cytobandHeight)
      .attr('rx', params.cytobandHeight * 0.25)
      .attr('ry', params.cytobandHeight * 0.25)
    // 2. draw all Giemsa bands
    this.cytobands.forEach(band => {
      if (arm.overlaps(band)) {
        svgElem.append('rect')
          .attr('x', band.start / this.constructor.dataScale)
          .attr('y', svgElem.attr('height') - params.cytobandHeight)
          .attr('clip-path', 'url(#' + arm.name + ')')
          .attr('width', (band.end - band.start) / this.constructor.dataScale)
          .attr('height', params.cytobandHeight)
          .attr('fill', this.constructor.getCytobandColor(band))
        if (band.gieStain === 'gvar' || band.gieStain === 'stalk') {
          // add hatch fill to these two types of bands
          svgElem.append('rect')
            .attr('x', band.start / this.constructor.dataScale)
            .attr('y', svgElem.attr('height') - params.cytobandHeight)
            .attr('clip-path', 'url(#' + arm.name + ')')
            .attr('width', (band.end - band.start) / this.constructor.dataScale)
            .attr('height', params.cytobandHeight)
            .attr('fill', 'url(#hatch_fill)')
        }
      }
    })
  }

  drawSelf (svgElem, params) {
    if (this.cytobands.length) {
      let arms
      if (this.centromere) {
        // draw two arms
        arms = [
          new ChromRegion({
            chr: this.chr,
            start: this.start,
            end: this.centromere.start,
            name: this.name + '_arm_1'
          }),
          new ChromRegion({
            chr: this.chr,
            start: this.centromere.end,
            end: this.end,
            name: this.name + '_arm_2'
          })
        ]
      } else {
        // draw only one arm
        arms = [this]
      }
      arms.forEach(arm => this.drawArm(svgElem, arm, params))
    } else {
      // no cytobands, just draw a bar
      svgElem.append('rect')
        .attr('x', 0)
        .attr('y', svgElem.attr('height') - params.chromosomeBarHeight)
        .attr('width', this.end / this.constructor.dataScale)
        .attr('height', params.chromosomeBarHeight)
        .attr('fill', '#000000')
    }
  }
}

Chromosome.dataScale = 1

/**
 * Parse a chrom.sizes file and return a list of chromosomes
 *
 * chrom.sizes will be a delimited file with the following columns:
 * *   `name`: chromosomal name
 * *   `size`: chromosome size
 * @param {string} fileContent - Chrom size file content
 * @param {Array<Chromosome>} [chromosomes] - chromosome array (with a map)
 * @returns {Array<Chromosome>} The result set of chromosomes
 */
function parseChromSizeFile (fileContent, chromosomes) {
  chromosomes = chromosomes || []
  chromosomes.map = chromosomes.map || {}
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
 * @param {string} fileContent - cytobandIdeo file content
 * @param {Array<Chromosome>} [chromosomes] - chromosome array (with a map)
 * @returns {Array<Chromosome>} The result set of chromosomes
 */
function parseCytobandIdeoFile (fileContent, chromosomes) {
  chromosomes = chromosomes || []
  chromosomes.map = chromosomes.map || {}
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
 * Stack chromosomes so the result becomes like the following:
 * ```json
 *  [
 *    ["chr1", "chr4"],
 *    ["chr2", "chr3"]
 *  ]
 * ```
 *
 * @param {Array<Chromosome>} chromosomeList - List of chromosomes to be
 *  stacked
 * @returns {Array<Array<Chromosome>>} Stacked chromosomes
 */
function stackChromosomes (chromosomeList) {
  let stack = []
  chromosomeList = chromosomeList.sort(ChromRegion.compare)
  let totalLength = parseInt((chromosomeList.length + 1) / 2) * 2
  chromosomeList.forEach((chromosome, index) => {
    if (index < totalLength / 2) {
      // first half
      stack.push([chromosome])
    } else {
      stack[totalLength - 1 - index].push(chromosome)
    }
  })
  return stack
}

function getStackedChromosomes (chromosomes) {
  // separate chromosomes by numbered and non-numbered
  return stackChromosomes(chromosomes.filter(chrom => chrom.isNumbered))
    .concat(stackChromosomes(chromosomes.filter(chrom => !chrom.isNumbered)))
}

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
    'A file in UCSC cytoBandIdeo format')
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
    parseInt, 100000)
  .option('-b, --with-borders',
    'Add borders to data entries. This will make tiny data more visible at ' +
    'the expense of resolution and fidelity.')
  .option('-h, --height <height>', 'Vertical height for every dataset.',
    parseFloat, 5)
  .option('--cytoband-height <cytobandHeight>',
    'Vertical height for cytoband ideograms', parseFloat, 10)
  .option('--chromosome-bar-height <cytobandHeight>',
    'Vertical height for chromosome bar (if no cytoband ideogram is drawn',
    parseFloat, 1)
  .option('-G, --gap <gap>',
    'Vertical gap between chromosomes', parseFloat, 15)
  .option('-g, --in-gap <inGap>',
    'Vertical gap between datasets within a chromosome.', parseFloat, 2)
  .option('--horizontal-gap <horiGap>',
    'Minimal horizontal gap when stacking chromosomes', parseFloat, 50)
  .option('--text-size <textSize>',
    'Size of the text in the labels (px)', parseFloat, 16)
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

program.labels = program.labels || program.args
Chromosome.dataScale = program.scale

var readChromInfoPromise

if (program.chromSizes) {
  readChromInfoPromise = readFilePromise(program.chromSizes, 'utf8')
    .then(result => parseChromSizeFile(result))
} else {
  readChromInfoPromise = readFilePromise(program.cytobandIdeo, 'utf8')
    .then(result => parseCytobandIdeoFile(result))
}

// Filter non-regular and/or mito chromosomes
readChromInfoPromise = readChromInfoPromise.then(
  chromosomes => chromosomes.filter(chromosome => (
    (program.includeNonRegular || chromosome.isRegular) ||
    (program.includeMito && chromosome.isMitochondrial)
  ))
)

var readDataPromise = program.args.map(arg =>
  readFilePromise(arg, 'utf8').catch(err => {
    console.error(err)
    return null
  })
)

/**
 * *   Calculate the size of each chromosome
 *     *   Stack chromosomes if needed
 *         Numbered chromosomes will be grouped together in stacks
 */

if (program.stacked) {
  readChromInfoPromise = readChromInfoPromise.then(chromosomes => {
    chromosomeStacks = getStackedChromosomes(chromosomes)
    return chromosomes
  })
} else {
  readChromInfoPromise = readChromInfoPromise.then(chromosomes => {
    chromosomeStacks = chromosomes.map(chromosome => [chromosome])
    return chromosomes
  })
}

const { document } = (new JSDOM()).window
var mainSvg

/**
 * *   Calculate the size of the final output, build the main `<svg>` element
 */

readChromInfoPromise = readChromInfoPromise.then(chromosomes => {
  var svgPlaceHolder = d3.select(document.body).append('svg')
  let maxInternalWidth = 0
  chromosomeStacks.forEach((stackEntry, stackIndex) => {
    let internalWidth = 0
    stackEntry.forEach((chromosome, index) => {
      let textMeasureElem = svgPlaceHolder.append('text')
        .style('font-family', 'Arial, Helvetica, sans-serif')
        .style('font-size', program.textSize + 'px')
        .text(chromosome.name)
      let currTextWidth = textMeasureElem.getBBox().width
      if (textLabelWidth[index] < currTextWidth) {
        textLabelWidth = currTextWidth
      }
      textMeasureElem.remove()
      internalWidth += chromosome.end / program.scale
      if (index > 0) {
        internalWidth += program.horizonalGap
      }
    })
    if (maxInternalWidth < internalWidth) {
      maxInternalWidth = internalWidth
    }
  })
  svgWidth = maxInternalWidth + program.textGap + textLabelWidth[0]
  if (program.stack && textLabelWidth[1] > 0) {
    svgWidth += program.textGap + textLabelWidth[1]
  }
  svgPlaceHolder.remove()
  return chromosomes
})

/**
 * *   Rasterize every chromosome with scale
 * *   Read BED data and put them into the rasters
 */

readDataPromise = readDataPromise.map((dataPromise, dataIndex) =>
  Promise.all([dataPromise, readChromInfoPromise]).then(resultArray => {
    let fileContent = resultArray[0]
    if (!fileContent) { // read file failed
      return null
    }
    let label = program.labels[dataIndex] || program.args[dataIndex]
    let chromosomes = resultArray[1]
    chromosomes.forEach(chromosome =>
      chromosome.initData(label)
    )
    fileContent.trim().split('\n').forEach(line => {
      // a BED entry
      // For now no strand information is taken
      let tokens = line.trim().split(/\s+/)
      let bedEntry = new ChromRegion({
        chr: tokens[0],
        start: parseInt(tokens[1]),
        end: parseInt(tokens[2])
      })
      if (chromosomes.map.hasOwnProperty(bedEntry.chr)) {
        chromosomes.map[bedEntry.chr].addData(label, bedEntry)
      }
    })
    return chromosomes
  })
)

/**
 * *   Calculate the size of the final output, build the main `<svg>` element
 */

var allDataDonePromise = Promise.all(readDataPromise).then(
  results => results.filter(result => !!result)
).then(results => {
  svgEntryHeight = results.length * (program.height + program.inGap) +
    (program.cytobandIdeo
      ? program.cytobandHeight
      : program.chromosomeBarHeight)
  svgHeight = chromosomeStacks.length * (svgEntryHeight + program.gap) -
    program.gap

  mainSvg = d3.select(document.body).append('svg')
    .attr('width', svgWidth)
    .attr('height', svgHeight)
    .append('defs')
    .append('pattern')
    .attr({
      id: 'hatch_fill',
      width: '8',
      height: '8',
      patternUnits: 'userSpaceOnUse',
      patternTransform: 'rotate(60)'
    })
    .append('rect')
    .attr({
      width: '2',
      height: '8',
      transform: 'translate(0,0)',
      fill: '#000000'
    })
  return results[0]
})

/**
 * *   Draw every chromosome
 */
allDataDonePromise = allDataDonePromise.then(chromosomes => {
  chromosomeStacks.forEach((stackEntry, stackIndex) => {
    stackEntry.forEach((chromosome, colIndex) => {
      /**
       *     *   Create the sub-`<svg>` element at the correct location
       */
      let svgEntryWidth = chromosome.end / Chromosome.dataScale + 1
      let subSvg = mainSvg.append('svg')
        .attr('x', !colIndex
          ? textLabelWidth[colIndex] + program.textGap
          : svgWidth - textLabelWidth[colIndex] -
            program.textGap - svgEntryWidth
        )
        .attr('y', stackIndex * (svgEntryHeight + program.gap))
        .attr('width', svgEntryWidth)
        .attr('height', svgEntryHeight)
        .attr('viewBox', '0 0 ' + svgEntryWidth + ' ' + svgEntryHeight)

      /**
       *     *   Draw rasterized BED data on the chromosome
       */
      program.labels.forEach((label, lblIndex) => {
        chromosome.drawData(subSvg, label, lblIndex, program)
      })

      /**
       *     *   Draw cytoband ideogram (if any) of the chromosome
       */
      chromosome.drawSelf(subSvg, program)

      /**
       *     *   Create chromosomal label **outside** the sub-`<svg>` element
       */
      mainSvg.append('text')
        .attr('x', !colIndex
          ? textLabelWidth[colIndex]
          : svgWidth - textLabelWidth[colIndex])
        .attr('y', stackIndex * (svgEntryHeight + program.gap) +
          svgEntryHeight / 2 + program.textSize / 2)
        .attr('text-anchor', !colIndex ? 'end' : 'start')
        .style('font-family', 'Arial, Helvetica, sans-serif')
        .style('font-size', program.textSize + 'px')
        .text(chromosome.name)
    })
  })
  return chromosomes
})

/**
 * *   Write the main `<svg>` element to stdout
 */
allDataDonePromise.then(chromosomes => {
  process.stdout.write(d3.select(document.body).html())
})
