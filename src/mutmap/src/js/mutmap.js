$(document).ready(function() {

  // The placeholder tags below will be replaced with the correct data objects
  // by the build system. See mutmap/tools/layout_and_template.R
  //
  // provides pedigreeFileText
  /*PEDIGREE_FILE_TEXT_PLACEHOLDER*/
  // provides layoutData
  /*LAYOUT_DATA_PLACEHOLDER*/
  // provides dngOutputFileText
  /*DNG_VCF_DATA_PLACEHOLDER*/

  window.pedigreeFileText = pedigreeFileText;
  window.layoutData = layoutData;
  window.dngOutputFileText = dngOutputFileText;

  var pedigreeData = pedParser.parsePedigreeFile(pedigreeFileText);
  var pedGraph = buildGraphFromPedigree(pedigreeData);
  var kinshipPedigreeData = layoutData;
  var graphData = processPedigree(kinshipPedigreeData);

  var startTime = new Date();

  var vcfData = vcfParser.VcfParser.create()
    .parse({ vcfText: dngOutputFileText });

  var endTime = new Date();
  var elapsed = endTime - startTime;
  console.log("Parsing time:", elapsed / 1000);

  console.log(vcfData);

  var mainContainer = document.querySelector('.main-container');
 
  var dimensions = utils.getDimensions(d3.select(mainContainer));

  var currentView = null;
  var mutationDistributionView = null;
  var mutationLocationsView = null;
  var mutationExplorerView = null;

  // Create new detached containers for the top level views

  var mutationDistributionContainer = d3.select(document.createElement('div'))
      .attr("class", "mutation-distribution-container")
      .style("width", dimensions.width+'px')
      .style("height", dimensions.height+'px');

  var mutationLocationsContainer = d3.select(document.createElement('div'))
      .attr("class", "mutation-locations-container")
      .style("width", dimensions.width+'px')
      .style("height", dimensions.height+'px');

  var mutationExplorerContainer = d3.select(document.createElement('div'))
      .attr("class", "mutation-explorer-container container")
      .style("width", dimensions.width+'px')
      .style("height", dimensions.height+'px');

  $(window).resize(function() {
    var dimensions = utils.getDimensions(d3.select(mainContainer));

    [
      mutationDistributionContainer,
      mutationLocationsContainer,
      mutationExplorerContainer
    ].forEach(function(container) {
        container
            .style("width", dimensions.width+'px')
            .style("height", dimensions.height+'px');
    });

    currentView.render();
  });

  var Router = Backbone.Router.extend({
    routes : {
      "": "root",
      "distribution": "distribution",
      "locations": "locations",
      "explorer": "explorer"
    },

    root: function() {
      // default to distribution view
      this.navigate("#/distribution");
    },

    distribution: function() {

      mainContainer.replaceChild(mutationDistributionContainer.node(),
        mainContainer.lastChild);

      if (!mutationDistributionView) {
        mutationDistributionView = new mutmap.MutationDistributionView({
          el: mutationDistributionContainer.node(),
          graphData: graphData,
          vcfText: dngOutputFileText,
        });
      }

      currentView = mutationDistributionView;
      currentView.render();
    },

    locations: function() {

      mainContainer.replaceChild(mutationLocationsContainer.node(),
        mainContainer.lastChild);

      if (!mutationLocationsView) {

        var model = new mutmap.MutationLocationsModel({
          mutationLocationData: buildMutationLocationData(vcfData)
        });

        mutationLocationsView = new mutmap.MutationLocationsView({
          el: mutationLocationsContainer.node(),
          model: model
        });
      }

      currentView = mutationLocationsView;
      currentView.render();
    },

    explorer: function() {

      mainContainer.replaceChild(mutationExplorerContainer.node(),
        mainContainer.lastChild);

      if (!mutationExplorerView) {

        mutationExplorerView = new mutmap.MutationExplorerView({
          el: mutationExplorerContainer.node(),
          graphData: graphData,
          pedGraph: pedGraph,
          vcfData: vcfData,
        });
      }

      currentView = mutationExplorerView;
      currentView.render();
    }
  });

  var router = new Router();
  Backbone.history.start();

  function processPedigree(kinshipPedigreeData) {


    var layout = kinshipPedigreeData.layout;
    var nodes = [];
    var links = [];

    var xMax = 0;
    var yMax = 0;

    layout.nid.forEach(function(row, rowIdx) {
      for (var colIdx = 0; colIdx < layout.n[rowIdx]; colIdx++) {
        var x = layout.pos[rowIdx][colIdx];
        var y = rowIdx;

        if (x > xMax) {
          xMax = x;
        }
        if (y > yMax) {
          yMax = y;
        }
      }
    });

    // build person nodes
    layout.nid.forEach(function(row, rowIdx) {
      for (var colIdx = 0; colIdx < layout.n[rowIdx]; colIdx++) {

        var id = row[colIdx];

        var node = {};
        node.type = "person";
        node.dataNode =
          pedGraph.getPerson(pedigreeData[oneToZeroBase(id)].individualId);

        // x and y are ratios
        node.x = layout.pos[rowIdx][colIdx] / xMax;
        node.y = rowIdx / yMax;

        // TODO: such a hack. remove
        node.rowIdx = rowIdx;
        node.colIdx = colIdx;

        nodes.push(node);
      }
    });

    // build marriage nodes and links
    nodes.forEach(function(node, index) {
      if (layout.spouse[node.rowIdx][node.colIdx] === 1) {
        var spouseNode = nodes[index + 1];

        var marriageNode = createMarriageNode(node, spouseNode);
        nodes.push(marriageNode);

        links.push(createMarriageLink(node, marriageNode));
        links.push(createMarriageLink(spouseNode, marriageNode));

        var marriage = pedigr.MarriageBuilder.createMarriageBuilder()
          .spouse(node.dataNode)
          .spouse(spouseNode.dataNode)
          .build();

        pedGraph.addMarriage(marriage);

        var children = getAllChildren(kinshipPedigreeData, nodes, node,
                                      spouseNode);

        var encountered = [];

        children.forEach(function(childNode) {
          var index = encountered.findIndex(function(element) {
            return element.dataNode === childNode.dataNode;
          });

          var childLink;
          var parentageLink;

          if (index === -1) {
            // TODO: this is duplicated below. fix it
            childLink = createChildLink(childNode, marriageNode);
            parentageLink = marriage.addChild(childNode.dataNode);
            childLink.dataLink = parentageLink;
            links.push(childLink);
            encountered.push(childNode);
          }
          else {
            var oldOne = encountered[index];
            var distanceOldOneToParents = distanceBetweenNodes(oldOne,
              marriageNode);
            var distanceCurrentToParents = distanceBetweenNodes(childNode,
              marriageNode);
            
            if (distanceOldOneToParents > distanceCurrentToParents) {
              var linkIndex = links.findIndex(function(element) {
                return element.type === "child" &&
                  element.source.dataNode === childNode.dataNode;
              });
              links.splice(linkIndex, 1);

              childLink = createChildLink(childNode, marriageNode);
              parentageLink = marriage.addChild(childNode.dataNode);
              childLink.dataLink = parentageLink;
              links.push(childLink);
            }

            var duplicateLink = createDuplicateLink(childNode, oldOne);
            links.push(duplicateLink);
          }
        });

      }

      // TODO: such a hack. remove
      delete node.rowIdx;
      delete node.colIdx;
    });

    return { nodes: nodes, links: links };
  }

  function createMarriageNode(spouseA, spouseB) {
    var marriageNode = {};
    marriageNode.x = utils.halfwayBetween(spouseA.x, spouseB.x);
    marriageNode.y = spouseA.y;
    marriageNode.type = "marriage";
    marriageNode.dataNode = {};
    return marriageNode;
  }

  function getAllChildren(kinshipPedigreeData, nodes, nodeA, nodeB) {
    var father;
    var mother;
    if (nodeA.dataNode.sex === "male") {
      father = nodeA;
      mother = nodeB;
    }
    else {
      father = nodeB;
      mother = nodeA;
    }

    var children = [];
    nodes.forEach(function(node) {
      if (node.type != "marriage") {

        var pedigree = kinshipPedigreeData.pedigree;
        var index = oneToZeroBase(findIndexFromId(node.dataNode.id));

        if (pedigree.findex[index] === findIndexFromId(father.dataNode.id) &&
            pedigree.mindex[index] === findIndexFromId(mother.dataNode.id)) {
          children.push(node);
        }
      }
    });

    return children;
  }


  function createMarriageLink(spouseNode, marriageNode) {
    var marriageLink = {};
    marriageLink.type = "spouse";
    marriageLink.source = spouseNode;
    marriageLink.target = marriageNode;
    return marriageLink;
  }

  function buildGraphFromPedigree(pedigreeData) {
    var pedGraph = pedigr.PedigreeGraph.createGraph();

    pedigreeData.forEach(function(individual) {
      var person = pedigr.PersonBuilder
        .createPersonBuilder(individual.individualId)
          .sex(individual.sex)
          .data({ sampleIds: individual.sampleIds })
          .build();
      pedGraph.addPerson(person);
    });

    return pedGraph;
  }

  function oneToZeroBase(index) {
    return index - 1;
  }

  function createChildLink(childNode, marriageNode) {
    var childLink = {};
    childLink.type = "child";
    childLink.source = childNode;
    childLink.target = marriageNode;
    return childLink;
  }

  function createDuplicateLink(nodeA, nodeB) {
    var dupLink = {};
    dupLink.type = "duplicate";
    dupLink.source = nodeA;
    dupLink.target = nodeB;
    return dupLink;
  }

  function findIndexFromId(id) {
    for (var i = 0; i < pedigreeData.length; i++) {
      if (pedigreeData[i].individualId == id) {
        return i+1;
      }
    }
  }

  function distanceBetweenNodes(nodeA, nodeB) {
    return utils.distanceBetweenPoints(nodeA.x, nodeA.y, nodeB.x, nodeB.y);
  }

  function buildMutationLocationData(vcfData) {

    // Build mutation location data
    var data = {};
    vcfData.records.forEach(function(record) {
      if (data[record.CHROM] === undefined) {
        data[record.CHROM] = {
          samples: {}
        };
      }

      // Find chromosome length
      for (var i = 0; i < vcfData.header.contig.length; i++) {
        var contig = vcfData.header.contig[i];
        if (contig.ID === record.CHROM) {
          data[record.CHROM].length = contig.length;
          break;
        }
      }

      if (data[record.CHROM].samples[record.INFO.DNL] === undefined) {
        data[record.CHROM].samples[record.INFO.DNL] = [];
      }

      data[record.CHROM].samples[record.INFO.DNL].push(record.POS);

    });

    var processed = [];
    Object.keys(data).forEach(function(chromKey) {

      var chrom = [];

      Object.keys(data[chromKey].samples).forEach(function(sampleKey) {
        chrom.push({
          sampleName: sampleKey,
          mutationLocations: data[chromKey].samples[sampleKey]
        });
      });

      chrom = utils.sortByKey({
        array: chrom,
        sortKey: 'sampleName',
        descending: false
      });

      processed.push({
        chrom: chromKey,
        samples: chrom,
        length: data[chromKey].length
      });
    });

    return processed;
  }

});

