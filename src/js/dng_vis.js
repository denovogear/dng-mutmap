// eslint exceptions
//
/* global d3 */
/* global PubSub */
/* global pedParser */
/* global PedigreeView*/
/* global vcfParser */
/* global pedigr */
/* global utils */
/* global contigView */
/* global StatsView */

/* global pedigreeFileText */
/* global layoutData */
/* global dngOutputFileText */

(function(d3, PubSub) {
  "use strict";

  // The placeholder tags below will be replaced with the correct data objects
  // by the build system. See mutmap/tools/layout_and_template.R
  //
  // provides pedigreeFileText
  /*PEDIGREE_FILE_TEXT_PLACEHOLDER*/
  // provides layoutData
  /*LAYOUT_DATA_PLACEHOLDER*/
  // provides dngOutputFileText
  /*DNG_VCF_DATA_PLACEHOLDER*/

  
  var pedigreeData = pedParser.parsePedigreeFile(pedigreeFileText);
  var pedGraph = buildGraphFromPedigree(pedigreeData);
  var kinshipPedigreeData = layoutData;
  var graphData = processPedigree(kinshipPedigreeData);
  var vcfData = vcfParser.parseVCFText(dngOutputFileText);
  // TODO: Using globals. Hack. Use a better method.
  var selectedContigIndex = 0;
  var selectedMutationIndex = 0;
  var ownerParentageLink;

  // transform contigs to hierarchical format
  var contigData = [];
  vcfData.header.contig.forEach(function(contig) {
    var id = Number(contig.ID);
    var contig = {
      id: id,
      length: contig.length,
      records: []
    };

    vcfData.records.forEach(function(record) {
      if (id === Number(record.CHROM)) {
        contig.records.push(record);
      }
    });

    contigData.push(contig);
  });

  // Create genome browser view
  var v = contigView.createContigView({
    renderInto: d3.select("#genome_browser_wrapper"),
    vcfData: vcfData,
    contigData: contigData,
    selectedContigIndex: selectedContigIndex,
    selectedMutationIndex: selectedMutationIndex
  });

  dngOverlay(vcfData.header, vcfData.records[0]);

  // Create pedigree view
  var pedView = new PedigreeView(d3.select(".pedigree-container"), graphData);

  // Create stats view
  new StatsView(d3.select(".stats-container"));

  window.addEventListener("resize", function() {
    var dimensions = windowDimensions();

    PubSub.publish("WINDOW_RESIZE");
  });

  PubSub.subscribe("MUTATION_CLICKED", function(topic, data) {
    updateMutation();
  });

  PubSub.subscribe("PREV_MUTATION_BUTTON_CLICKED", function(topic, data) {
    
    selectedMutationIndex--;
    if (selectedMutationIndex === -1) {

      selectedContigIndex--;
      if (selectedContigIndex === -1) {
        selectedContigIndex = contigData.length - 1;
        selectedMutationIndex = 0;
      }

      selectedMutationIndex =
        contigData[selectedContigIndex].records.length - 1;
    }

    updateMutation();
  });

  PubSub.subscribe("NEXT_MUTATION_BUTTON_CLICKED", function(topic, data) {

    selectedMutationIndex++;
    if (selectedMutationIndex ===
        contigData[selectedContigIndex].records.length) {

      selectedMutationIndex = 0;

      selectedContigIndex++;
      if (selectedContigIndex === contigData.length) {
        selectedContigIndex = 0;
        selectedMutationIndex = 0;
      }
    }

    updateMutation();
  });

  function updateMutation() {
    ownerParentageLink.getData().mutation = undefined;
    dngOverlay(vcfData.header,
      contigData[selectedContigIndex].records[selectedMutationIndex]);
    PubSub.publish("MUTATION_INDEX_UPDATED", { 
      selectedContigIndex: selectedContigIndex,
      selectedMutationIndex: selectedMutationIndex
    });
    PubSub.publish("DNG_OVERLAY_UPDATE");
  }

  PubSub.subscribe("MUTATION_SELECTED", function(topic, data) {

    // find matching contig and mutation indexes
    for (var i = 0; i < contigData.length; i++) {
      if (contigData[i].id === Number(data.CHROM)) {

        var contigIndex = i;
        for (var j = 0; j < contigData[i].records.length; j++) {
          if (contigData[i].records[j].POS === data.POS) {
            selectedContigIndex = i;
            selectedMutationIndex = j;
            updateMutation();
            break;
          }
        }
        break;
      }
    }
  });

  function dngOverlay(header, record) {

    var mutationLocation = record.INFO.DNL;
    var owner = findOwnerNode(mutationLocation);

    if (owner !== undefined) {
      ownerParentageLink = owner.getParentageLink();
      var parentageLinkData = {
        mutation: record.INFO.DNT
      };
      ownerParentageLink.setData(parentageLinkData);

      header.sampleNames.forEach(function(sampleName) {
        var format = record[sampleName];

        // TODO: Using libraries for now, but might be more correct to use
        // GL-1, GL-2, etc nodes?
        if (isLibraryNode(sampleName)) {
          var id = getIdFromLibraryName(sampleName);
          var personNode = pedGraph.getPerson(id);
          personNode.data.dngOutputData = format;
        }

        //if (isPersonNode(sampleName)) {
        //  var id = getIdFromSampleName(sampleName);
        //  var personNode = pedGraph.getPerson(id);
        //  personNode.data.dngOutputData = format;
        //}
        //else {
        //  var sampleNode = findMatchingSampleNode(sampleName);
        //  sampleNode.dngOutputData = format;
        //}
      });
    }
    else {
      throw "No mutation found";
    }
  }

  function processPedigree(kinshipPedigreeData) {


    var layout = kinshipPedigreeData.layout;
    var nodes = [];
    var links = [];

    // build person nodes
    layout.nid.forEach(function(row, rowIdx) {
      for (var colIdx = 0; colIdx < layout.n[rowIdx]; colIdx++) {

        var id = row[colIdx];

        var node = {};
        node.type = "person";
        node.dataNode =
          pedGraph.getPerson(pedigreeData[oneToZeroBase(id)].individualId);
        node.x = 120 * layout.pos[rowIdx][colIdx];
        node.y = 120 * rowIdx;

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

  // TODO this and findMatchingSampleNode have almost the same logic. Find a
  // way to extract the duplication
  function findOwnerNode(sampleName) {
    //var strippedName = getStrippedName(sampleName);
    var persons = pedGraph.getPersons();
    for (var index = 0; index < persons.length; index++) {
      var person = persons[index];
      //var sampleNode = findInTree(person.data.sampleIds, strippedName);
      var sampleNode = findInTree(person.data.sampleIds, sampleName);
      if (sampleNode !== undefined) {
        return person;
      }
    }
    return undefined;
  }

  function findMatchingSampleNode(sampleName) {
    var strippedName = getStrippedName(sampleName);
    var persons = pedGraph.getPersons();
    for (var index = 0; index < persons.length; index++) {
      var person = persons[index];
      var sampleNode = findInTree(person.data.sampleIds, strippedName);
      if (sampleNode !== undefined) {
        return sampleNode;
      }
    }
    return undefined;
  }

  function findInTree(tree, sampleName) {

    // TODO: This seems very likely to break in the future. Need to find a
    // robust way of matching up sample names and libraries.
    if (tree.name != "" && sampleName.includes(tree.name)) {
      return tree;
    }

    if (tree.children !== undefined) {
      if (tree.children.length === 0) {
        return undefined;
      }
      else {
        for (var index = 0; index < tree.children.length; index++) {
          var child = tree.children[index];
          var inChild = findInTree(child, sampleName);
          if (inChild !== undefined) {
            return inChild;
          }
        }
      }
    }

    return undefined;
  }

  function getStrippedName(sampleName) {
    var stripped = sampleName.slice(3, sampleName.indexOf(":"));
    return stripped;
  }

  function isPersonNode(sampleName) {
    return sampleName.startsWith("GL-");
  }

  function isLibraryNode(sampleName) {
    return sampleName.startsWith("LB-");
  }

  function getIdFromSampleName(sampleName) {
    return sampleName.slice(3);
  }

  function getIdFromLibraryName(sampleName) {
    return Number(sampleName.slice(-3));
  }

  function oneToZeroBase(index) {
    return index - 1;
  }

  function createMarriageNode(spouseA, spouseB) {
    var marriageNode = {};
    marriageNode.x = utils.halfwayBetween(spouseA.x, spouseB.x);
    marriageNode.y = spouseA.y;
    marriageNode.type = "marriage";
    marriageNode.dataNode = {};
    return marriageNode;
  }

  function createMarriageLink(spouseNode, marriageNode) {
    var marriageLink = {};
    marriageLink.type = "spouse";
    marriageLink.source = spouseNode;
    marriageLink.target = marriageNode;
    return marriageLink;
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

  function windowDimensions() {
    var w = window,
        d = document,
        e = d.documentElement,
        g = d.getElementsByTagName('body')[0],
        x = w.innerWidth || e.clientWidth || g.clientWidth,
        y = w.innerHeight|| e.clientHeight|| g.clientHeight;

    return { x: x, y: y };
  }
 
}(d3, PubSub));
