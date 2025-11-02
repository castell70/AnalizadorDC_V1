import * as d3 from 'd3';

export function renderNetwork(data, container){
  container.innerHTML = '';
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const width = Math.max(cw, 1600);
  const height = Math.max(ch, 1200);
  const svg = d3.select(container).append('svg')
    .attr('width', width).attr('height', height);

  const color = d3.scaleOrdinal()
    .domain(['axis','category','subtheme','code','quote'])
    .range(['#2563eb','#16a34a','#0ea5e9','#4b5563','#9ca3af']);

  const sim = d3.forceSimulation(data.nodes)
    .force('link', d3.forceLink(data.links).id(d=>d.id).distance(d=>{
      if(d.target.type==='quote') return 45;
      if(d.target.type==='code') return 80;
      if(d.target.type==='subtheme') return 110;
      return 140;
    }).strength(0.5))
    .force('charge', d3.forceManyBody().strength(-180))
    .force('center', d3.forceCenter(width/2, height/2))
    .force('collide', d3.forceCollide().radius(d=> d.type==='quote'?14:20));

  const links = svg.append('g')
    .selectAll('line')
    .data(data.links)
    .enter().append('line')
    .attr('stroke', '#e5e7eb')
    .attr('stroke-width', 1.2);

  const nodes = svg.append('g')
    .selectAll('circle')
    .data(data.nodes)
    .enter().append('circle')
      .attr('r', d=> d.type==='quote'?4 : d.type==='code'?7 : d.type==='subtheme'?9 : d.type==='category'?11 : 13)
      .attr('fill', d=> color(d.type))
      .call(drag(sim));

  const labels = svg.append('g')
    .selectAll('text')
    .data(data.nodes.filter(d=>d.type!=='quote'))
    .enter().append('text')
      .text(d => {
        if(d.type==='category') return d.id.replace(/^CAT:/,'');
        if(d.type==='subtheme') return d.id.split(':').slice(2).join(':');
        if(d.type==='code') return d.id.split(':').slice(2).join(':').slice(0,24);
        return 'Eje';
      })
      .attr('font-size', 10)
      .attr('font-weight', 700)
      .attr('fill', '#374151');

  nodes.append('title').text(d=>{
    if(d.type==='quote') return d.label ? `${d.doc}: ${d.label}` : 'Cita';
    return d.id;
  });

  sim.on('tick', ()=>{
    links
      .attr('x1', d=>d.source.x).attr('y1', d=>d.source.y)
      .attr('x2', d=>d.target.x).attr('y2', d=>d.target.y);
    nodes.attr('cx', d=>d.x).attr('cy', d=>d.y);
    labels.attr('x', d=>d.x+14).attr('y', d=>d.y+5);
  });
}

function drag(sim){
  function dragstarted(event, d){
    if(!event.active) sim.alphaTarget(0.3).restart();
    d.fx = d.x; d.fy = d.y;
  }
  function dragged(event, d){
    d.fx = event.x; d.fy = event.y;
  }
  function dragended(event, d){
    if(!event.active) sim.alphaTarget(0);
    d.fx = null; d.fy = null;
  }
  return d3.drag().on('start', dragstarted).on('drag', dragged).on('end', dragended);
}

