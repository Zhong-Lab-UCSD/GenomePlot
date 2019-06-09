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

/**
 * Color palette
 * This palette is adapted from Paul Tol's "Muted" qualitative color scheme
 * https://personal.sron.nl/~pault/
 */
const colorPalette = [
  '#CC6677', // rose
  '#332288', // indigo
  '#DDCC77', // sand
  '#117733', // green
  '#88CCEE', // cyan
  '#882255', // wine
  '#44AA99', // teal
  '#999933', // olive
  '#AA4499' // purple
]

const cytobandColor = '#777777'
const BORDER_GAP = 1
const TEXT_RATIO = 0.6

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
    this.cytobands.sort(this.constructor.compare)
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
    for (let i = Math.round(bedEntry.start / this.constructor.dataScale);
      i <= Math.round(bedEntry.end / this.constructor.dataScale);
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

  static getCytobandOpacity (band) {
    switch (band.gieStain) {
      case 'stalk':
        return 0.75
      case 'gpos100':
      case 'gvar':
        return 1.0
      case 'gneg':
        return 0.0
      default:
        // calculate color based on `gposxxx` value
        let result = band.gieStain.match(/^gpos(\d+)/)
        if (!result) {
          return 0.0
        } else {
          let gposValue = parseFloat(result[1]) / 100
          if (gposValue < 0) {
            return 0.0
          } else if (gposValue > 1) {
            return 1.0
          } else {
            // calculate the intermediate value
            return gposValue
          }
        }
    }
  }

  drawArm (svgElem, y, arm, params) {
    // Steps
    // 1. draw arms and centromere backgrounds
    svgElem.append('rect')
      .attr('x', arm.start / this.constructor.dataScale)
      .attr('y', y)
      .attr('width', (arm.end - arm.start) / this.constructor.dataScale)
      .attr('height', params.cytobandHeight)
      .attr('fill', '#FFFFFF')
      .attr('rx', params.cytobandHeight * 0.25)
      .attr('ry', params.cytobandHeight * 0.25)
    svgElem.append('clipPath')
      .attr('id', arm.name)
      .append('rect')
      .attr('x', arm.start / this.constructor.dataScale)
      .attr('y', y)
      .attr('width', (arm.end - arm.start) / this.constructor.dataScale)
      .attr('height', params.cytobandHeight)
      .attr('rx', params.cytobandHeight * 0.25)
      .attr('ry', params.cytobandHeight * 0.25)
    // 2. draw all Giemsa bands
    this.cytobands.forEach(band => {
      if (arm.overlaps(band)) {
        svgElem.append('rect')
          .attr('x', band.start / this.constructor.dataScale)
          .attr('y', y)
          .attr('clip-path', 'url(#' + arm.name + ')')
          .attr('width', (band.end - band.start) / this.constructor.dataScale)
          .attr('height', params.cytobandHeight)
          .attr('stroke', 'none')
          .attr('fill', cytobandColor)
          .attr('fill-opacity', this.constructor.getCytobandOpacity(band))
        if (band.gieStain === 'gvar' || band.gieStain === 'stalk') {
          // add hatch fill to these two types of bands
          svgElem.append('rect')
            .attr('x', band.start / this.constructor.dataScale)
            .attr('y', y)
            .attr('clip-path', 'url(#' + arm.name + ')')
            .attr('width', (band.end - band.start) / this.constructor.dataScale)
            .attr('height', params.cytobandHeight)
            .attr('stroke', 'none')
            .attr('fill', 'url(#hatch_fill)')
        }
      }
    })
    // 3. draw arms and centromere borders
    svgElem.append('rect')
      .attr('x', arm.start / this.constructor.dataScale)
      .attr('y', y)
      .attr('width', (arm.end - arm.start) / this.constructor.dataScale)
      .attr('height', params.cytobandHeight)
      .attr('stroke', '#000000')
      .attr('stroke-width', 1)
      .attr('fill', 'none')
      .attr('rx', params.cytobandHeight * 0.25)
      .attr('ry', params.cytobandHeight * 0.25)
  }

  drawSelf (svgElem, params, y) {
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
      arms.forEach(arm => this.drawArm(svgElem, y, arm, params))
    } else {
      // no cytobands, just draw a bar
      svgElem.append('rect')
        .attr('x', 0)
        .attr('y', y)
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
 *     *   `gpos***`: ***% Giemsa stain
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
 * Return sorted and filtered chromosomes
 *
 * @param {Array<Chromosome>} chromosomes Chromosome array
 * @param {boolean} includeNonRegular Whether non-regular chromosomes
 * (`chrUn` and alike) shall be included.
 * @param {boolean} includeMito Whether mitochondria chromosomes (`chrM`) shall
 * be included
 * @returns {Array<Chromosome>} Filtered chromosomes
 */
function filterChromosome (chromosomes, includeNonRegular, includeMito) {
  return chromosomes.sort(Chromosome.compare).filter(chromosome => (
    (includeNonRegular || chromosome.isRegular) ||
    (includeMito && chromosome.isMitochondrial)
  ))
}

/**
 * @typedef {object} SvgWidths
 * @property {number} svgWidth Total width for the svg
 * @property {Array<number>} textLabelWidth Width for text label(s), if two-
 * column plot is used, there will be two width values.
 */

/**
 * @function
 * Calculate the size of the final output, build the main `<svg>` element
 * @param {Array<Array<Chromosome>>} chromosomeStacks Stacks of chromosome
 * @param {Node} containerDom Container DOM object
 * @param {object} params Additional parameters
 * @param {boolean} params.stacked Whether chromosome shall be stacked to make
 * a two-column plot.
 * @param {number} params.textSize Size of the text, in px.
 * @param {number} params.scale Scale of the final figure, in bp / px.
 * @param {number} params.horizontalGap Horizontal gap between stacked
 * chromosomes in px.
 * @param {number} params.textGap Gap between chromosome and its label
 * in px.
 * @returns {SvgWidths}
 */
function calcSvgWidths (chromosomeStacks, containerDom, params) {
  var svgPlaceHolder = d3.select(containerDom).append('svg')
  let maxInternalWidth = 0
  let textLabelWidth = [0]

  if (params.stacked) {
    textLabelWidth.push(0)
  }
  chromosomeStacks.forEach((stackEntry, stackIndex) => {
    let internalWidth = 0
    stackEntry.forEach((chromosome, index) => {
      let currTextWidth = chromosome.name.length * TEXT_RATIO *
        params.textSize
      if (textLabelWidth[index] < currTextWidth) {
        textLabelWidth[index] = currTextWidth
      }
      internalWidth += chromosome.end / params.scale
      if (index > 0) {
        internalWidth += params.horizontalGap
      }
    })
    if (maxInternalWidth < internalWidth) {
      maxInternalWidth = internalWidth
    }
  })
  let svgWidth = maxInternalWidth + params.textGap +
    textLabelWidth[0] + 2 * BORDER_GAP
  if (params.stacked && textLabelWidth[1] > 0) {
    svgWidth += params.textGap + textLabelWidth[1] + 2 * BORDER_GAP
  }
  svgPlaceHolder.remove()
  return {
    svgWidth,
    textLabelWidth
  }
}

/**
 * Add BED data to chromosomes
 *
 * @param {string} bedFileContent Content of the BED file
 * @param {string} label label of the BED file, used to distinguish multiple BED
 * files.
 * @param {Array<Chromosome>} chromosomes The array of chromosomes
 * @returns {Array<Chromosome>|null} Return `chromosomes` if successful, `null`
 * if unsuccessful (no data in `bedFileContent`)
 */
function addBedData (bedFileContent, label, chromosomes) {
  if (!bedFileContent) { // read file failed
    return null
  }
  chromosomes.forEach(chromosome =>
    chromosome.initData(label)
  )
  bedFileContent.trim().split('\n').forEach(line => {
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
}

/**
 * @typedef {object} ChromosomesWithStack
 * @property {Array<Chromosome>} chromosomes flattened array of chromosomes
 * @property {Array<Array<Chromosome>>} stack Stacked chromosomes
 *
 * @function
 * @async
 * Prepare chromosome data structure for plotting
 *
 * @param {object} params Additional parameters
 * @param {string} [params.chromSizes] Chromosome size file name.
 * @param {string} [params.cytobandIdeo] CytobandIdeo file name.
 * @param {boolean} params.stacked Whether chromosome shall be stacked to make
 * a two-column plot.
 * @param {number} params.scale Scale of the final figure, in bp / px.
 * @param {boolean} [params.includeNonRegular] Whether non-regular chromosomes
 * (`chrUn` and alike) shall be included.
 * @param {boolean} [params.includeMito] Whether mitochondria chromosomes
 * (`chrM`) shall be included
 * @returns {ChromosomesWithStack}
 */
async function prepareChromosomeFromFile (params) {
  if (typeof params.scale === 'number' && params.scale > 0) {
    Chromosome.dataScale = params.scale
  }

  let chromosomes, chromosomeStacks

  if (params.chromSizes) {
    chromosomes = await readFilePromise(params.chromSizes, 'utf8')
      .then(result => parseChromSizeFile(result))
  } else {
    chromosomes = await readFilePromise(params.cytobandIdeo, 'utf8')
      .then(result => parseCytobandIdeoFile(result))
  }

  // Filter non-regular and/or mito chromosomes
  chromosomes = filterChromosome(
    chromosomes, params.includeNonRegular, params.includeMito
  )

  /**
   * *   Calculate the size of each chromosome
   *     *   Stack chromosomes if needed
   *         Numbered chromosomes will be grouped together in stacks
   */
  if (params.stacked) {
    chromosomeStacks = getStackedChromosomes(chromosomes)
  } else {
    chromosomeStacks = chromosomes.map(chromosome => [chromosome])
  }

  return {
    chromosomes,
    stacks: chromosomeStacks
  }
}

/**
 * Create an SVG element within a container element
 *
 * @param {Node} containerDom
 * @param {number} svgWidth
 * @param {number} svgHeight
 * @returns {SVGElement}
 */
function _createSvgElem (containerDom, svgWidth, svgHeight) {
  let result = d3.select(containerDom).append('svg')
    .attr('width', svgWidth)
    .attr('height', svgHeight)
    .attr('version', 1.1)
    .attr('xmlns', 'http://www.w3.org/2000/svg')
  result.append('defs')
    .append('pattern')
    .attr('id', 'hatch_fill')
    .attr('width', '8')
    .attr('height', '8')
    .attr('patternUnits', 'userSpaceOnUse')
    .attr('patternTransform', 'rotate(60)')
    .append('rect')
    .attr('width', '2')
    .attr('height', '8')
    .attr('transform', 'translate(0,0)')
    .attr('fill', '#000000')
  return result
}

/**
 * Draw one single chromosome stack layer
 *
 * @param {Array<Chromosome>} chromesomeStack One single chromosome stack
 * @param {number} stackIndex Index of the stack
 * @param {SVGElement} mainSvg SVG element
 * @param {number} svgWidth Width of the SVG element.
 * @param {number} svgEntryHeight Height of a single SVG entry, in px.
 * @param {Array<number>} textLabelWidth Width of text labels, in px.
 * @param {object} params Additional parameters
 * @param {number} params.gap Gap between chromosome stacks, in px.
 * @param {number} params.textGap Gap between chromosome and its label
 * in px.
 * @param {Array<string>} params.labels Labels of all the data.
 * @param {string} [params.cytobandIdeo] CytobandIdeo file name.
 * @param {number} [params.cytobandHeight] Height of cytoband (if cytoband is
 * present), in px.
 * @param {number} [params.chromosomeBarHeight] Height of the chromosome bar
 * (if cytoband is not present), in px.
 */
function _drawSingleChromosomeStack (
  chromesomeStack, stackIndex, mainSvg, svgWidth, svgEntryHeight,
  textLabelWidth, params
) {
  chromesomeStack.forEach((chromosome, colIndex) => {
    /**
      *     *   Create the sub-`<svg>` element at the correct location
      */
    let svgEntryWidth = chromosome.end / Chromosome.dataScale + 1
    let subSvg = mainSvg.append('svg')
      .attr('x', !colIndex
        ? textLabelWidth[colIndex] + params.textGap
        : svgWidth - textLabelWidth[colIndex] -
        params.textGap - svgEntryWidth
      )
      .attr('y', stackIndex * (svgEntryHeight + params.gap))
      .attr('width', svgEntryWidth + 2)
      .attr('height', svgEntryHeight + 2)
      .attr('viewBox', '-1 -1 ' + (svgEntryWidth + 1) + ' ' +
        (svgEntryHeight + 1))

    /**
      *     *   Draw rasterized BED data on the chromosome
      */
    params.labels.forEach((label, lblIndex) => {
      chromosome.drawData(subSvg, label, lblIndex, params)
    })

    /**
      *     *   Draw cytoband ideogram (if any) of the chromosome
      */
    let chromosomeY = svgEntryHeight -
      (params.cytobandIdeo ? params.cytobandHeight : params.chromosomeBarHeight)
    chromosome.drawSelf(subSvg, params, chromosomeY)

    /**
      *     *   Create chromosomal label **outside** the sub-`<svg>` element
      */
    mainSvg.append('text')
      .attr('x', !colIndex
        ? textLabelWidth[colIndex]
        : svgWidth - textLabelWidth[colIndex])
      .attr('y', stackIndex * (svgEntryHeight + params.gap) +
        svgEntryHeight / 2 + params.textSize / 2)
      .attr('text-anchor', !colIndex ? 'end' : 'start')
      .style('font-family', 'Arial, Helvetica, sans-serif')
      .style('font-size', params.textSize + 'px')
      .text(chromosome.name)
  })
}

/**
 *
 *
 * @param {Node} containerDom
 * @param {Array<chromosome>} chromosomes
 * @param {Array<Array<Chromosome>>} chromosomeStacks
 * @param {Array<string>} bedFiles
 * @param {object} params Additional parameters
 * @param {string} [params.chromSizes] Chromosome size file name.
 * @param {string} [params.cytobandIdeo] CytobandIdeo file name.
 * @param {boolean} [params.includeNonRegular] Whether non-regular chromosomes
 * (`chrUn` and alike) shall be included.
 * @param {boolean} [params.includeMito] Whether mitochondria chromosomes
 * (`chrM`) shall be included
 * @param {number} params.height Height of each data track, in px.
 * @param {number} params.gap Gap between chromosome stacks, in px.
 * @param {number} params.inGap Gap between different BED tracks, in px.
 * @param {number} params.textSize Size of the text, in px.
 * @param {number} params.textGap Horizontal gap between chromosome and its
 * label in px.
 * @param {number} params.horizontalGap Horizontal gap between stacked
 * chromosomes in px.
 * @param {boolean} params.stacked Whether chromosome shall be stacked to make
 * a two-column plot.
 * @param {Array<string>} params.labels Labels of all the data.
 * @param {number} params.scale Scale of the final figure, in bp / px.
 * @param {number} [params.cytobandHeight] Height of cytoband (if cytoband is
 * present), in px.
 * @param {number} [params.chromosomeBarHeight] Height of the chromosome bar
 * (if cytoband is not present), in px.
 * @returns {SVGElement}
 */
function drawGenomePlot (
  containerDom, chromosomes, chromosomeStacks, bedFiles, params
) {
  containerDom = containerDom ||
    (new JSDOM('', { pretendToBeVisual: true })).window.document.body
  var mainSvg

  var { svgWidth, textLabelWidth } =
    calcSvgWidths(chromosomeStacks, containerDom, params)
  var svgHeight = 0
  var svgEntryHeight = 0

  /**
   * *   Rasterize every chromosome with scale
   * *   Read BED data and put them into the rasters
   */
  let validBedFiles = bedFiles.map((bedFile, bedFileIndex) => {
    let label = params.labels[bedFileIndex] || params.args[bedFileIndex]
    return addBedData(bedFile, label, chromosomes)
  }).filter(result => !!result)

  /**
   * *   Calculate the size of the final output, build the main `<svg>` element
   */

  svgEntryHeight = validBedFiles.length * (params.height + params.inGap) +
    (params.cytobandIdeo ? params.cytobandHeight : params.chromosomeBarHeight)
  svgHeight = chromosomeStacks.length * (svgEntryHeight + 2 + params.gap) -
    params.gap

  mainSvg = _createSvgElem(containerDom, svgWidth, svgHeight)

  /**
   * *   Draw every chromosome
   */
  chromosomeStacks.forEach((stackEntry, stackIndex) =>
    _drawSingleChromosomeStack(stackEntry, stackIndex, mainSvg, svgWidth,
      svgEntryHeight, textLabelWidth, params)
  )

  /**
   * *   Write the main `<svg>` element to stdout
   */
  return mainSvg
}

/**
 * @async
 * Create a genome plot from annotation files and data files.
 *
 * @param {object} params All parameters, see below.
 * @param {string} [params.chromSizes] Chromosome size file name.
 * @param {string} [params.cytobandIdeo] CytobandIdeo file name.
 * @param {Array<string>} params.args Data file names.
 * @param {boolean} [params.includeNonRegular] Whether non-regular chromosomes
 * (`chrUn` and alike) shall be included.
 * @param {boolean} [params.includeMito] Whether mitochondria chromosomes
 * (`chrM`) shall be included
 * @param {number} params.height Height of each data track, in px.
 * @param {number} params.gap Gap between chromosome stacks, in px.
 * @param {number} params.inGap Gap between different BED tracks, in px.
 * @param {number} params.textSize Size of the text, in px.
 * @param {number} params.textGap Horizontal gap between chromosome and its
 * label in px.
 * @param {number} params.horizontalGap Horizontal gap between stacked
 * chromosomes in px.
 * @param {boolean} params.stacked Whether chromosome shall be stacked to make
 * a two-column plot.
 * @param {Array<string>} params.labels Labels of all the data.
 * @param {number} params.scale Scale of the final figure, in bp / px.
 * @param {number} [params.cytobandHeight] Height of cytoband (if cytoband is
 * present), in px.
 * @param {number} [params.chromosomeBarHeight] Height of the chromosome bar
 * (if cytoband is not present), in px.
 * @returns {string} The SVG HTML code for the final result, can be directly
 * written into a `.svg` file.
 */
async function createGenomePlot (params) {
  var readDataPromise = params.args.map(arg =>
    readFilePromise(arg, 'utf8').catch(err => {
      console.error(err)
      return null
    })
  )
  var chromPromise = prepareChromosomeFromFile(params)
  var bedFiles = await Promise.all(readDataPromise)
  var { chromosomes, stacks: chromosomeStacks } = await chromPromise
  return drawGenomePlot(null, chromosomes, chromosomeStacks, bedFiles, params)
    .node().outerHTML
}

module.exports.drawGenomePlot = drawGenomePlot
module.exports.parseCytobandIdeo = parseCytobandIdeoFile
module.exports.parseChromSizes = parseChromSizeFile
module.exports.Chromosome = Chromosome
module.exports.getStackedChromosomes = getStackedChromosomes

module.exports.createGenomePlot = createGenomePlot
