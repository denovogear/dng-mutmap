var d3 = require('d3');
var vcfParser = require('./dng_vcf_parser');
var pedParser = require('./ped_parser');
var pedigr = require('./pedigr');

var pedigreeFileText;
var dngOutputFileText;

jQuery.get('example_pedigree.ped', function(data) {
    pedigreeFileText = data;
    main();
});

function main() {

  d3.select('#pedigree_file_input').on('change', updatePedigreeFile);
  d3.select('#dng_output_file_input').on('change', updateDNGOutputFile);

  var idText = d3.select('#id_display');
  
  serverPedigreeAndLayout();

  function dngOverlay() {
    vcfParser.parseVCFText(dngOutputFileText);
  }

  function serverPedigreeAndLayout() {
    var pedigreeUploadData = { text: pedigreeFileText };
    jQuery.ajax('/pedigree_and_layout',
      { 
        type: 'POST',
        data: JSON.stringify(pedigreeUploadData),
        contentType: 'application/json',
        success: gotLayoutData
      });

    function gotLayoutData(jsonData) {
      //console.log(jsonData);
      var layoutData = JSON.parse(jsonData);

      var pedigreeData = pedParser.parsePedigreeFile(pedigreeFileText);

      var ret = processPedigree(layoutData, pedigreeData);
      var nodes = ret.nodes;
      var links = ret.links;

      var height = 500;

      d3.select("svg").remove();

      var zoom = d3.zoom()
        .on("zoom", zoomed);


      var chartWrapper= d3.select("#chart_wrapper")
      var dim = chartWrapper.node().getBoundingClientRect();

      var svg = chartWrapper.append("svg")
          .attr("width", dim.width)
          .attr("height", height);

      var container = svg.call(zoom)
        .append("g");

        
      var link = container
        .append("g")
          .attr("class", "links")
        .selectAll("line")
        .data(links)
        .enter().append("line")
          .attr("stroke-width", 1);
      link
        .attr("x1", function(d) { return d.source.x; })
        .attr("y1", function(d) { return d.source.y; })
        .attr("x2", function(d) { return d.target.x; })
        .attr("y2", function(d) { return d.target.y; });


      var node = container
        .append("g")
          .attr("class", "nodes")
        .selectAll(".node")
        .data(nodes)
        .enter()
        .append("g")
          .attr("class", "node")
          .on("mouseover", mouseover);

      node.append("path")
        .attr("d", d3.symbol()
          .type(function(d) {
            if (d.type === 'male') {
              return d3.symbolSquare;
            }
            else if (d.type === 'female') {
              return d3.symbolCircle;
            }
            else {
              return d3.symbolTriangle;
            }
          })
          .size(500))
        .attr("fill", function(d) { 
          if (d.type === 'male') {
            return "SteelBlue";
          }
          else if (d.type === 'female') {
            return "Tomato";
          }
          else {
            return "black";
          }
        })
        .attr('opacity', function(d) {
          if (d.type === 'marriage') {
            return 0;
          }
          else {
            return 1;
          }
        });

      node.append("text")
        .attr("dx", 20)
        .attr("dy", ".35em")
        .text(function(d) { 
          if (d.type !== 'marriage') {
            return d.dataNode.id
          }
        });
      
      node.attr("transform", function(d) {
          return "translate(" + d.x + "," + d.y + ")";
      });

      function zoomed() {
        container.attr("transform", d3.event.transform);
      }

      function mouseover(d) {
        if (d.type !== 'marriage') {
          document.getElementById('id_display').value =
            d.dataNode.data.sampleIds.children[0].name;
        }
      }

    }

  }

  function processPedigree(data, pedigreeData) {
    console.log(pedigreeData);

    var pedGraph = buildGraphFromPedigree(pedigreeData);

    console.log(pedGraph);

    var layout = data.layout;
    var nodes = [];
    var links = [];

    // build person nodes
    layout.nid.forEach(function(row, rowIdx) {
      for (var colIdx = 0; colIdx < layout.n[rowIdx]; colIdx++) {
        var id = row[colIdx];
        var node = {};

        //node.dataNode = {id: id};
        node.dataNode = pedGraph.getPerson(id);
        node.x = 80 * layout.pos[rowIdx][colIdx];
        node.y = 100 * rowIdx;

        node.type = getGender(data.pedigree, id);

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

        var children = getAllKids(data, nodes, node, spouseNode);

        for (var childNode of children) {
          var childLink = createChildLink(childNode, marriageNode);
          links.push(childLink);
        }

      }

      // TODO: such a hack. remove
      delete node.rowIdx;
      delete node.colIdx;
    });

    return { nodes: nodes, links: links };
  }

  function buildGraphFromPedigree(pedigreeData) {
    var pedGraph = pedigr.PedigreeGraph.createGraph();

    pedigreeData.forEach(function(person) {
      var attr = {
        id: person.individualId,
        sex: person.sex,
        data: { sampleIds: person.sampleIds }
      };
      var person = pedigr.Person.createPerson(attr);
      pedGraph.addPerson(person);
    });

    return pedGraph;
  }

  function oneToZeroBase(index) {
    return index - 1;
  }

  function newNode(id) {
    return { id: id };
  }

  function createMarriageNode(spouseA, spouseB) {
    var marriageNode = {};
    marriageNode.x = halfwayBetween(spouseA, spouseB);
    marriageNode.y = spouseA.y;
    marriageNode.type = "marriage";
    marriageNode.dataNode = {};
    return marriageNode;
  }

  function createMarriageLink(spouseNode, marriageNode) {
    var marriageLink = {};
    marriageLink.type = 'spouse';
    marriageLink.source = spouseNode;
    marriageLink.target = marriageNode;
    return marriageLink;
  }

  function createChildLink(childNode, marriageNode) {
    var childLink = {};
    childLink.type = 'child';
    childLink.source = childNode;
    childLink.target = marriageNode;
    return childLink;
  }

  function getAllKids(data, nodes, nodeA, nodeB) {
    var father;
    var mother;
    if (nodeA.type === 'male') {
      father = nodeA;
      mother = nodeB;
    }
    else {
      father = nodeB;
      mother = nodeA;
    }

    var kids = [];
    for (var node of nodes) {
      if (node.type != 'marriage') {
        if (data.pedigree.findex[oneToZeroBase(node.dataNode.id)] === father.dataNode.id &&
            data.pedigree.mindex[oneToZeroBase(node.dataNode.id)] === mother.dataNode.id) {
          kids.push(node);
        }
      }
    }

    return kids;
  }

  function halfwayBetween(nodeA, nodeB) {
    if (nodeB.x > nodeA.x) {
      return nodeA.x + ((nodeB.x - nodeA.x) / 2);
    }
    else {
      return nodeB.x + ((nodeA.x - nodeB.x) / 2);
    }
  }

  function getGender(pedigree, id) {
    return pedigree.sex[oneToZeroBase(id)];
    //for (var i in pedigree.id) {
    //  if (pedigree.id[i] === id) {
    //    return pedigree.sex[i];
    //  }
    //}
  }

  function updatePedigreeFile() {
    updateFile('pedigree_file_input', function(fileData) {
      pedigreeFileText = fileData;
      serverPedigreeAndLayout();
    });
  }

  function updateDNGOutputFile() {
    updateFile('dng_output_file_input', function(fileData) {
      dngOutputFileText = fileData;
      dngOverlay();
    });
  }

  function updateFile(fileInputElementId, callback) {
    var selectedFile = document.getElementById(fileInputElementId).files[0];

    if (selectedFile !== undefined) {
      var reader = new FileReader();

      reader.onload = function(readerEvent) {
        callback(reader.result);
      };
      reader.readAsText(selectedFile);
    }
  }
}
