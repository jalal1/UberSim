const urls = {
    // TopoJSON format
    map: "data/counties-albers-10m.json",
    // GeoJSON format for some zipcodes in Alabama
    zipcodes: "data/AL_Zip_Codes.geojson",
    used_zipcodes: "data/used_zipcodes.csv",
    // uber trips count
    trips: "data/uber_trips.csv"
};

const svg = d3.select("svg");
// d3.selectAll('svg').attr("transform", "scale(4)");
const width = parseInt(svg.attr("width"));
const height = parseInt(svg.attr("height"));
const hypotenuse = Math.sqrt(width * width + height * height);

const scales = {
    // used to scale airport bubbles
    outgoing_cir: d3.scaleSqrt()
        .range([1, 8]),

    incoming_cir: d3.scaleSqrt()
        .range([1, 5]),

    // used to scale number of segments per line
    segments: d3.scaleLinear()
        .domain([0, hypotenuse])
        .range([1, 10]),

    zipcode_colorScale: d3.scaleThreshold()
        .domain([10, 20, 40, 80, 160, 320, 640, 1280, 2560])
        .range(d3.schemeBlues[7])
};

// have these already created for easier drawing
var g;
// const g = {
//     basemap: svg.select("g#basemap"),
//     trips: svg.select("g#trips"),
//     uberzipcodes: svg.select("g#uberzipcodes"),
//     voronoi: svg.select("g#voronoi")
// };

var tooltip;
// const tooltip = d3.select("text#tooltip");
// console.assert(tooltip.size() === 1);

// define the projection in drawzipcodes()
var projection;
// All zipcodes in AL
var zipcodes;
var used_zipcodes_array = [];
var trips;

// start by reading the data
const promises = [
    d3.csv(urls.used_zipcodes),
    d3.csv(urls.trips, typeTrips),
    d3.json(urls.zipcodes)
];

refresh();
Promise.all(promises).then(processData);

// start sliders
var outgoing_slider_data = [0, 50, 100, 150, 200, 400];

var outgoing_sliderStep = d3
    .sliderBottom()
    .min(d3.min(outgoing_slider_data))
    .max(d3.max(outgoing_slider_data))
    .width(300)
    // .tickFormat(d3.format('.2%'))
    .ticks(10)
    .step(1)
    // .default(0.015)
    .on('onchange', val => {
        refresh();
        update_filters(val, null);
    });

var gStep = d3
    .select('div#slider-step')
    .append('svg')
    .attr('width', 500)
    .attr('height', 100)
    .append('g')
    .attr('transform', 'translate(30,30)');

gStep.call(outgoing_sliderStep);
// end sliders

// to save filters
var filters = { outgoing_threshold: 0, incoming_threshold: 0, set: false };
// init value to infinity

// d3.select('p#value-step').text(sliderStep.value());

function refresh() {
    // remove all previous drawings
    // d3.selectAll("g > *").remove()
    d3.selectAll("g#basemap > *").remove()
    d3.selectAll("g#trips > *").remove()
    d3.selectAll("g#uberzipcodes > *").remove()
    d3.selectAll("g#voronoi > *").remove()
        // redraw
    g = {
        basemap: svg.select("g#basemap"),
        trips: svg.select("g#trips"),
        uberzipcodes: svg.select("g#uberzipcodes"),
        voronoi: svg.select("g#voronoi")
    };

    tooltip = d3.select("text#tooltip");
    console.assert(tooltip.size() === 1);

    // zoom
    svg.call(d3.zoom().on('zoom', () => {
        g.basemap.attr('transform', d3.event.transform);
        g.trips.attr('transform', d3.event.transform);
        g.uberzipcodes.attr('transform', d3.event.transform);
        g.voronoi.attr('transform', d3.event.transform);
    }));


}
// var filtered_zipcodes;
// var filtered_trips;
var zipcodes_dic;
// process uberzipcodes, Alabama zipcodes and trips
function processData(data) {

    // first time only, data generated from source files. After that, only filters are passed.
    // keep original data. Filter data and save to a copy
    if (data) {
        // console.log(data);
        used_zipcodes_array = data[0];
        trips = data[1];
        zipcodes = data[2];

        // filter Alabama zipcodes depend on used_zipcodes_array from uber data
        zipcodes.features = zipcodes.features.filter(isSpecificZipcode);
        // console.log(trips, zipcodes);

        // convert zctas array (pre filter) into map (dictionary) for fast lookup
        zipcodes_dic = new Map(zipcodes.features.map(node => [node.properties.ZIP, node]));

        // filtered_trips = trips;
        // filtered_zipcodes = zipcodes;
    }

    // for each zipcode, init the outgoing and incoming counts
    zipcodes.features.forEach(function(zipcode) {
        zipcode.trips = [];
        zipcode.outgoing = 0;
        zipcode.incoming = 0;
    });
    trips.forEach(function(link) {
        // link.source is the zipcode object, same for target.
        link.source = zipcodes_dic.get(link.origin);
        link.target = zipcodes_dic.get(link.destination);
        // console.log(link);
        console.assert(link.source && link.target);
        link.source.outgoing += link.count;
        link.target.incoming += link.count;
    });

    // filter the data when change the filters
    if (filters.set) {
        // console.log(trips);
        filtered_trips = trips.filter(trip_filter);
        // console.log(filtered_trips);

        // reset when filters are changed
        zipcodes.features.forEach(function(zipcode) {
            zipcode.trips = [];
            zipcode.outgoing = 0;
            zipcode.incoming = 0;
        });
        // recalculate the counts
        filtered_trips.forEach(function(link) {
            // link.source is the zipcode object, same for target.
            link.source = zipcodes_dic.get(link.origin);
            link.target = zipcodes_dic.get(link.destination);
            link.source.outgoing += link.count;
            link.target.incoming += link.count;
        });
    }
    // if (filters.set) {
    //     filtered_zipcodes.features = zipcodes.features.filter(zipcode_filter);
    // }

    // console.log(filtered_trips);
    // console.log(filtered_zipcodes);

    drawzipcodes();
    drawPolygons();

    if (filters.set == true) {
        drawtrips(filtered_trips);
    } else {
        drawtrips(trips);
    }
    console.log(filtered_trips.length);
    // console.log({ uber_zipcodes: zipcodes });
    // console.log({ trips: trips });
}

function drawzipcodes() {
    // use custom projection to enlarge and fit size
    // fit zipcodes GeoJSON object between the specified width and height
    projection = d3.geoAlbers().fitSize([width, height], zipcodes)

    // adjust scale
    // console.log(zipcodes)
    const out_extent = d3.extent(zipcodes.features, d => d.outgoing);
    scales.outgoing_cir.domain(out_extent);

    const in_extent = d3.extent(zipcodes.features, d => d.incoming);
    scales.incoming_cir.domain(in_extent);

    // path generator
    let path = d3.geoPath(projection);

    g.basemap.selectAll("path")
        .data(zipcodes.features)
        .enter()
        .append("path")
        .attr("class", "zipcode")
        // set the color of each zipcode
        .attr("fill", function(d) {
            // console.log(d.outgoing)
            return scales.zipcode_colorScale(d.outgoing);
        })
        .attr("d", path)

    // draw a circle at the center of each zipcode
    // draw outgoing circles
    g.uberzipcodes.selectAll()
        .data(zipcodes.features)
        .enter()
        .each(function(d) {
            // console.log(d.outgoing);
            // d.outgoing = 0; // eventually tracks number of outgoing trips
            // d.incoming = 0; // eventually tracks number of incoming trips
            // d.trips = []; // eventually tracks outgoing trips
            // get the center of the zipcode as a point (longitude, latitude)
            d.center = get_polygonCenter(d.geometry.coordinates[0]);
        })
        .append("circle")
        .attr("cx", function(d) {
            cx = projection(d.center)[0];
            d.x = cx;
            return cx;
        })
        .attr("cy", function(d) {
            cy = projection(d.center)[1];
            d.y = cy;
            return cy;
        })
        .attr("r", d => scales.outgoing_cir(d.outgoing))
        .attr("class", "outgoing_circle")
        .each(function(d) {
            // adds the circle object to our zipcodes
            // makes it fast to select zipcodes on hover
            d.bubble = this;
        })

    // draw incoming circles
    // g.uberzipcodes.selectAll()
    //     .data(zipcodes.features)
    //     .enter()
    //     .each(function(d) {
    //         // console.log(zipcode.x, zipcode.y);
    //         // d.outgoing = 0; // eventually tracks number of outgoing trips
    //         // d.incoming = 0; // eventually tracks number of incoming trips
    //         // d.trips = []; // eventually tracks outgoing trips
    //         // get the center of the zipcode as a point (longitude, latitude)
    //         d.center = get_polygonCenter(d.geometry.coordinates[0]);
    //     })
    //     // another circle for the incoming degree
    //     .append("circle")
    //     .attr("cx", function(d) {
    //         cx = projection(d.center)[0];
    //         d.x = cx;
    //         return cx;
    //     })
    //     .attr("cy", function(d) {
    //         cy = projection(d.center)[1];
    //         d.y = cy;
    //         return cy;
    //     })
    //     .attr("r", d => scales.incoming_cir(d.incoming))
    //     .attr("class", "incoming_circle")
}


// find polygon center
function get_polygonCenter(polygon_coordinates) {
    let x = 0;
    let y = 0;
    let n = polygon_coordinates.length;
    for (let i = 0; i < n; i++) {
        x += parseFloat(polygon_coordinates[i][0]);
        y += parseFloat(polygon_coordinates[i][1]);
    }
    return [x / n, y / n];
}

function drawPolygons() {
    // partition each zipcode circle into polygons, so when we hover over a polygon, zipcode's circle will be selected

    // convert array of uber_zipcodes into geojson format
    const geojson = zipcodes.features.map(function(zipcode) {
        return {
            type: "Feature",
            properties: zipcode,
            geometry: {
                type: "Point",
                coordinates: [zipcode.center[0], zipcode.center[1]]
            }
        };
    });


    // calculate voronoi polygons
    const polygons = d3.geoVoronoi().polygons(geojson);

    g.voronoi.selectAll("path")
        .data(polygons.features)
        .enter()
        .append("path")
        .attr("d", d3.geoPath(projection))
        .attr("class", "voronoi")
        .on("mouseover", function(d) {
            let zipcode = d.properties.site.properties;

            d3.select(zipcode.bubble)
                .classed("highlight", true);

            d3.selectAll(zipcode.trips)
                .classed("highlight", true)
                .raise();

            // make tooltip take up space but keep it invisible
            tooltip.style("display", null);
            tooltip.style("visibility", "hidden");

            // set default tooltip positioning
            tooltip.attr("text-anchor", "middle");
            tooltip.attr("dy", -scales.outgoing_cir(zipcode.outgoing) - 4);
            tooltip.attr("x", zipcode.x);
            tooltip.attr("y", zipcode.y);

            // set the tooltip text
            // tooltip.text(zipcode.name + " in " + zipcode.city + ", " + zipcode.state);
            tooltip.text(zipcode.properties.ZIP);

            // double check if the anchor needs to be changed
            let bbox = tooltip.node().getBBox();

            if (bbox.x <= 0) {
                tooltip.attr("text-anchor", "start");
            } else if (bbox.x + bbox.width >= width) {
                tooltip.attr("text-anchor", "end");
            }

            tooltip.style("visibility", "visible");
        })
        .on("mouseout", function(d) {
            let zipcode = d.properties.site.properties;

            d3.select(zipcode.bubble)
                .classed("highlight", false);

            d3.selectAll(zipcode.trips)
                .classed("highlight", false);

            d3.select("text#tooltip").style("visibility", "hidden");
        })
        .on("dblclick", function(d) {
            // toggle voronoi outline
            let toggle = d3.select(this).classed("highlight");
            d3.select(this).classed("highlight", !toggle);
        });
}

function drawtrips(trips) {
    // break each flight between airports into multiple segments
    let bundle = generateSegments(zipcodes, trips);
    // console.log(bundle);

    // https://github.com/d3/d3-shape#curveBundle
    let line = d3.line()
        .curve(d3.curveBundle)
        .x(uber_zipcode => uber_zipcode.x)
        .y(uber_zipcode => uber_zipcode.y);

    console.log(bundle)
        // create a line for each path
    let links = g.trips.selectAll("path.trip")
        .data(bundle.paths)
        .enter()
        .append("path")
        .attr("d", line)
        .attr("class", "trip")
        .each(function(d) {
            // adds the path object to our source airport
            // makes it fast to select outgoing paths
            d[0].trips.push(this);
        });

    // https://github.com/d3/d3-force
    let layout = d3.forceSimulation()
        // settle at a layout faster
        // سرعة التحريك او الذبذبة للوصول الى الموقع النهائي لكل مسار
        .alphaDecay(0.1)
        // nearby nodes attract each other
        .force("charge", d3.forceManyBody()
            .strength(2)
            // .distanceMax(scales.outgoing_cir.range()[1] * 5)
        )
        // edges want to be as short as possible
        // prevents too much stretching
        .force("link", d3.forceLink()
            .strength(0.9)
            .distance(0)
        )
        .on("tick", function(d) {
            links.attr("d", line);
        })
        .on("end", function(d) {
            console.log("layout complete");
        });

    layout.nodes(bundle.nodes).force("link").links(bundle.links);
}

// Turns a single edge into several segments that can
// be used for simple edge bundling.
function generateSegments(nodes, links) {
    // console.log(nodes);
    // console.log(links);
    // generate separate graph for edge bundling
    // nodes: all nodes including control nodes
    // links: all individual segments (source to target)
    // paths: all segments combined into single path for drawing
    let bundle = { nodes: [], links: [], paths: [] };

    // make existing nodes fixed
    bundle.nodes = nodes.features.map(function(d, i) {
        d.fx = d.x;
        d.fy = d.y;
        return d;
    });

    links.forEach(function(d, i) {
        // calculate the distance between the source and target
        let length = distance(d.source, d.target);
        // console.log(length);

        // calculate total number of inner nodes for this link
        let total = Math.round(scales.segments(length));

        // create scales from source to target
        let xscale = d3.scaleLinear()
            .domain([0, total + 1]) // source, inner nodes, target
            .range([d.source.x, d.target.x]);

        let yscale = d3.scaleLinear()
            .domain([0, total + 1])
            .range([d.source.y, d.target.y]);

        // initialize source node
        let source = d.source;
        let target = null;

        // add all points to local path
        let local = [source];

        for (let j = 1; j <= total; j++) {
            // calculate target node
            target = {
                x: xscale(j),
                y: yscale(j)
            };

            local.push(target);
            bundle.nodes.push(target);

            bundle.links.push({
                source: source,
                target: target
            });

            source = target;
        }

        local.push(d.target);

        // add last link to target node
        bundle.links.push({
            source: target,
            target: d.target
        });

        bundle.paths.push(local);
    });

    return bundle;
}

function isSpecificZipcode(zipcode) {
    // check if the zipcode is in the list of zipcodes
    return used_zipcodes_array.columns.some(x => x == zipcode.properties.ZIP);

}

// see trips.csv
// convert count to number
function typeTrips(trip) {
    trip.count = parseInt(trip.count);
    return trip;
}

function trip_filter(trip) {
    // if trip.outgoing is >= outgoin_filter_threshold, return true
    // console.log(trip.source.outgoing);
    // console.log(filters.outgoing_threshold);
    return trip.source.outgoing >= filters.outgoing_threshold
}

function zipcode_filter(zipcode) {
    // if trip.outgoing is >= outgoin_filter_threshold, return true
    // console.log(trip.source.outgoing);
    return zipcode.outgoing >= filters.outgoing_threshold
}

// calculates the distance between two nodes
// sqrt( (x2 - x1)^2 + (y2 - y1)^2 )
function distance(source, target) {
    // console.log(target.x, target.y);
    // console.log(source.x, source.y);
    if (source && target) {
        const dx2 = Math.pow(target.x - source.x, 2);
        const dy2 = Math.pow(target.y - source.y, 2);
        return Math.sqrt(dx2 + dy2);
    }
    return 0;

}

function update_filters(outgoing_threshold, incoming_threshold) {
    filters.set = true;
    if (outgoing_threshold) {
        filters.outgoing_threshold = outgoing_threshold;
    }
    if (incoming_threshold) {
        filters.incoming_threshold = incoming_threshold;
    }
    processData(null);
}