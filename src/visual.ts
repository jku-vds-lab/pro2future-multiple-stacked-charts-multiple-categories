/*
 *  Power BI Visual CLI
 *
 *  Copyright (c) Microsoft Corporation
 *  All rights reserved.
 *  MIT License
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the ""Software""), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in
 *  all copies or substantial portions of the Software.
 *
 *  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 *  THE SOFTWARE.
 */
'use strict';

import 'core-js/stable';
import './../style/visual.less';
import 'regenerator-runtime/runtime';

import powerbi from 'powerbi-visuals-api';
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import EnumerateVisualObjectInstancesOptions = powerbi.EnumerateVisualObjectInstancesOptions;
import VisualObjectInstance = powerbi.VisualObjectInstance;
import VisualObjectInstanceEnumerationObject = powerbi.VisualObjectInstanceEnumerationObject;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import VisualEnumerationInstanceKinds = powerbi.VisualEnumerationInstanceKinds;
import ISelectionId = powerbi.visuals.ISelectionId;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import DataView = powerbi.DataView;
import { select as d3Select } from 'd3-selection';
import { scaleBand, scaleLinear } from 'd3-scale';
import { axisBottom, axisLeft, axisRight } from 'd3-axis';
import * as d3 from 'd3';
import { dataViewWildcard } from 'powerbi-visuals-utils-dataviewutils';
import { getAxisTextFillColor, getPlotFillColor, getValue, getVerticalRulerColor } from './objectEnumerationUtility';
import { createTooltipServiceWrapper, ITooltipServiceWrapper } from 'powerbi-visuals-utils-tooltiputils';
import { ViewModel, DataPoint, PlotModel, PlotType } from './plotInterface';
import { visualTransform } from './parseAndTransform';
import { Constants, EnableAxisNames, PlotSettingsNames, Settings } from './constants';
import { data } from 'jquery';
import { transform } from 'lodash-es';

type Selection<T1, T2 = T1> = d3.Selection<any, T1, any, T2>;
export class Visual implements IVisual {
    private host: IVisualHost;
    private element: HTMLElement;
    private visualContainer: d3.Selection<HTMLDivElement, any, HTMLDivElement, any>;
    private dataview: DataView;


    private viewModel: ViewModel;

    static Config = {
        xScalePadding: 0.1,
        solidOpacity: 1,
        transparentOpacity: 1,
        margins: {
            top: 10,
            right: 30,
            bottom: 30,
            left: 50,
        },
    };

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.element = options.element;
        this.visualContainer = d3.select(this.element).append('div').attr('class', 'visualContainer');
    }


    public update(options: VisualUpdateOptions) {

        try {
            this.dataview = options.dataViews[0];
            this.visualContainer.selectAll('*').remove();
            this.viewModel = visualTransform(options, this.host);

            let points: d3.Selection<SVGCircleElement, DataPoint, any, any>[] = [];
            let bars: d3.Selection<SVGRectElement, DataPoint, any, any>;


            for (let plotModel of this.viewModel.plotModels) {
                const plotType = plotModel.plotSettings.plotSettings.plotType;
                if (plotType == PlotType.LinePlot) {
                    const linePlot = this.drawLinePlot(options, plotModel, plotModel.plotId, plotModel.xName, plotModel.yName)
                    points.push(linePlot.points);
                }
                else if (plotType == PlotType.ScatterPlot) {
                    const scatterPlot = this.drawScatterPlot(options, plotModel, plotModel.plotId, plotModel.xName, plotModel.yName);
                    points.push(scatterPlot.points);
                }

                else if (plotType == PlotType.BarPlot) {
                    bars = this.drawBarPlot(options, plotModel, plotModel.plotId, plotModel.xName, plotModel.yName);
                }
            }
        } catch (error) {
            console.log(error());
        }
    }

    private getChartElement(options: VisualUpdateOptions, plotModel: PlotModel, xLabel?: string, yLabel?: string): any {
        let width = options.viewport.width - Visual.Config.margins.left - Visual.Config.margins.right;
        let height = 100;

        const colorObjects = options.dataViews[0] ? options.dataViews[0].metadata.objects : null;
        const plotType = plotModel.plotSettings.plotSettings.plotType;
        const plotNr = plotModel.plotId;
        const verticalRulerSettings = this.viewModel.verticalRulerSettings.verticalRulerSettings;
        const chart: Selection<any> = this.visualContainer
            .append('svg')
            .classed(plotType + plotNr, true)
            .classed('chart-selector', true)
            .attr('width', width)
            .attr('height', height)
            .append('g')

            .attr('transform', 'translate(' + Visual.Config.margins.left  + ',' + Visual.Config.margins.top + ')');
        const xAxis = chart.append('g').classed('xAxis', true);
        const yAxis = chart.append('g').classed('yAxis', true);
        const lineGroup = chart.append("g").attr("class", Constants.verticalRulerClass);
        let margins = Visual.Config.margins;
        height -= margins.bottom;
        lineGroup.append("line")
            .attr("stroke", verticalRulerSettings.fill)
            .attr("x1", 10).attr("x2", 10)
            .attr("y1", 0).attr("y2", height)



        const xScale = scaleLinear().domain([0, plotModel.xRange.max]).range([0, width]);

        const xAxisValue = axisBottom(xScale);

        if (!plotModel.formatSettings.enableAxis.enabled) {
            xAxisValue.tickValues([]);
        }

        xAxis
            .attr('transform', 'translate(0, ' + height + ')')
            .call(xAxisValue);

        // Displays the x-axis label. This also needs to be added in the format property
        // const xAxisLabel = chart
        //     .append('text')
        //     .attr('class', 'xLabel')
        //     .attr('text-anchor', 'end')
        //     .attr('x', width / 2)
        //     .attr('y', height + 20)
        //     .text(xLabel);

        const yScale = scaleLinear().domain([0, plotModel.yRange.max]).range([height, 0]);

        const yAxisValue = axisLeft(yScale).ticks(height / 20);

        yAxis.call(yAxisValue).attr(
            'color',
            getAxisTextFillColor(
                colorObjects,
                this.host.colorPalette,
                '#000000'
            )
        );

        const yAxisLabel = chart
            .append('text')
            .attr('class', 'yLabel')
            .attr('text-anchor', 'middle')
            .attr('y', 0 - Visual.Config.margins.left)
            .attr('x', 0 - height / 2)
            .attr('dy', '1em')
            .attr('transform', 'rotate(-90)')
            .text(yLabel);

        return {
            chart: chart,
            xScale: xScale,
            xAxisValue: xAxisValue,
            yScale: yScale,
            xAxis: xAxis,
        };
    }

    private drawLinePlot(options: VisualUpdateOptions, plotModel: PlotModel, visualNumber: number, xLabel?: string, yLabel?: string): any {

        try {
            let result = {};
            const chartInfo = this.getChartElement(options, plotModel, xLabel, yLabel);
            const lineChart = chartInfo.chart;
            const xScale = chartInfo.xScale;
            const yScale = chartInfo.yScale;
            const xAxis = chartInfo.xAxis;
            const dataPoints = filterNullValues(plotModel.dataPoints);

            lineChart
                .append('path')
                .datum(dataPoints)
                .attr(
                    'd',
                    d3
                        .line<DataPoint>()
                        .x((d) => xScale(<number>d.xValue))
                        .y((d) => yScale(<number>d.yValue))
                )
                .attr('fill', 'none')
                .attr('stroke', plotModel.plotSettings.plotSettings.fill)
                .attr('stroke-width', 1.5);

            const dots = lineChart
                .selectAll('dots')
                .data(dataPoints)
                .enter()
                .append('circle')
                .attr('fill', plotModel.plotSettings.plotSettings.fill)
                .attr('stroke', 'none')
                .attr('cx', (d) => xScale(<number>d.xValue))
                .attr('cy', (d) => yScale(<number>d.yValue))
                .attr('r', 2);

            let mouseEvents = this.customTooltip();
            dots.on('mouseover', mouseEvents.mouseover).on('mousemove', mouseEvents.mousemove).on('mouseout', mouseEvents.mouseout);

            result = { chart: lineChart, points: dots, xScale: xScale, yScale: yScale, xAxis: xAxis };
            //this.drawVerticalRuler(lineChart, dataPoints, xAxis, xScale, yScale);
            return result;
        } catch (error) {
            console.log('Error in Draw Line Chart: ', error);
        }
    }

    private customTooltip() {
        const tooltipOffset = 10;
        let visualContainer = this.visualContainer.node();
        var lines = d3.selectAll(`.${Constants.verticalRulerClass} line`);
        const margins = Visual.Config.margins;
        var Tooltip = this.visualContainer
            .append("div")
            .style("position", "absolute")
            .style("visibility", "hidden")
            .style("background-color", "white")
            .style("border", "solid")
            .style("border-width", "1px")
            .style("border-radius", "5px")
            .style("padding", "10px")
            .html("No tooltip info available");

        let mouseover = function () {
           lines = d3.selectAll(`.${Constants.verticalRulerClass} line`);
            Tooltip.style("visibility", "visible");
            d3.select(this)
                .attr('r', 4)
                .style("stroke", "black")
                .style("opacity", 1);
            lines.style("opacity", 1);
        };


        let plotModels = this.viewModel.plotModels;

        let mousemove = function (event, data) {

            const height = visualContainer.offsetHeight;
            const width = visualContainer.offsetWidth;
            let tooltipText = "";
            tooltipText = "<b> x value </b> : " + data.xValue + " <br> ";
            for (let plotModel of plotModels) {
                for (let point of plotModel.dataPoints) {
                    if (point.xValue == data.xValue) {
                        tooltipText += "<b> " + plotModel.yName + "</b> : " + point.yValue + " <br> ";
                        break;
                    }
                }
            }
            const x = event.clientX - margins.left;
            const tooltipX = event.clientX > width / 2 ? event.clientX - Tooltip.node().offsetWidth - tooltipOffset : event.clientX+tooltipOffset;
            const tooltipY = event.clientY > height / 2 ? event.clientY - Tooltip.node().offsetHeight - tooltipOffset : event.clientY+tooltipOffset;
            Tooltip
                .html(tooltipText)
                .style("left", (tooltipX) + "px")
                .style("top", (tooltipY) + "px");

            lines.attr("x1", x).attr("x2", x);

        };

        let mouseout = function () {
            Tooltip.style("visibility", "hidden");
            d3.select(this)
                .attr('r', 2)
                .style("stroke", "none")
                .style("opacity", 0.8);
            lines.style("opacity", 0);
        }
        return { mouseover, mousemove, mouseout };
    }

    private drawScatterPlot(options: VisualUpdateOptions, plotModel: PlotModel, visualNumber: number, xLabel?: string, yLabel?: string): any {
        try {
            debugger;
            let width = options.viewport.width - Visual.Config.margins.left - Visual.Config.margins.right;
            let height = 100;
            let result = {};
            const plotInfo = this.getChartElement(options, plotModel, xLabel, yLabel);
            const plot = plotInfo.chart;
            const xScale = plotInfo.xScale;
            const xAxisValue = plotInfo.xAxisValue;
            const yScale = plotInfo.yScale;
            const xAxis = plotInfo.xAxis;
            const dataPoints = filterNullValues(plotModel.dataPoints);

            const dots = plot
                .selectAll('dots')
                .data(dataPoints)
                .enter()
                .append('circle')
                .attr('fill', plotModel.plotSettings.plotSettings.fill)
                .attr('stroke', 'none')
                .attr('cx', (d) => xScale(<number>d.xValue))
                .attr('cy', (d) => yScale(<number>d.yValue))
                .attr('r', 2)
                .attr("transform", d3.zoomIdentity.translate(0, 0).scale(1));



                // Zoom
                let zoomed = function(event) {

                    let transform = event.transform;
                    transform.x = Math.min(0, transform.x);
                    transform.y = 0;

                    let xScaleNew = transform.rescaleX(xScale);
                    xAxisValue.scale(xScaleNew);
                    xAxis.call(xAxisValue);

                    dots.attr('cx', (d) => xScaleNew(<number>d.xValue))
                    .attr('r', 2);
                }

                let zoom = d3.zoom().scaleExtent([1, 10]).on('zoom', zoomed); // with scale extent you can control how much you scale

                var listenerRect = plot
                .append('rect')
                  .attr('class', 'listener-rect')
                  .attr('x', 0)
                  .attr('y',  0 - Visual.Config.margins.left)
                  .attr('width', width)
                  .attr('height', height )
                  .style('opacity', 0);

                listenerRect.call(zoom);

                let mouseEvents = this.customTooltip();
                dots.on('mouseover', mouseEvents.mouseover).on('mousemove', mouseEvents.mousemove).on('mouseout', mouseEvents.mouseout);


            result = { chart: dots, points: dots, xScale: xScale, yScale: yScale, xAxis: xAxis };
            // this.drawVerticalRuler(dots, dataPoints, xAxis, xScale, yScale);
            return result;
        } catch (error) {
            console.log('Error in ScatterPlot: ', error);
        }
    }


    private drawBarPlot(
        options: VisualUpdateOptions,
        plotModel: PlotModel,
        visualNumber: number,
        xLabel?: string,
        yLabel?: string
    ): d3.Selection<SVGRectElement, DataPoint, any, any> {
        let width = options.viewport.width - Visual.Config.margins.left - Visual.Config.margins.right;
        let height = 100;
        const chartInfo = this.getChartElement(options, plotModel, xLabel, yLabel);
        const barChart = chartInfo.chart;
        const xScale = chartInfo.xScale;
        const yScale = chartInfo.yScale;
        const dataPoints = filterNullValues(plotModel.dataPoints);
        const bar = barChart.selectAll('.bar').data(dataPoints);

        const mergedBars = bar
            .enter()
            .append('rect')
            .merge(<any>bar);
        mergedBars.classed('bar', true);
        mergedBars
            .attr('width', width / dataPoints.length - 1)
            .attr('height', (d) => height - yScale(<number>d.yValue))
            .attr('y', (d) => yScale(<number>d.yValue))
            .attr('x', (d) => xScale(<number>d.xValue))
            .style('fill', (dataPoint: DataPoint) => dataPoint.color);
        return mergedBars;
    }

    // private drawVerticalRuler(chart: any, dataPoints: DataPoint[], xAxis: any, xScale: any, yScale: any) {
    //     try {
    //         const margins = Visual.Config.margins;
    //         let bisect = d3.bisector((d: DataPoint) => <number>d.xValue).left;
    //         let focus = chart.append('circle').style('fill', 'none').attr('stroke', 'black').attr('r', 8.5).style('opacity', 0);
    //         let lineGroup = chart.append("g").attr("class", Constants.verticalRulerClass);
    //         let line = lineGroup
    //             .append("line")
    //             .attr("stroke", "red")
    //             .attr("x1", 10).attr("x2", 10)
    //             .attr("y1", 0).attr("y2", 100);
    //         let mouseover = function () {
    //             line.style('opacity', 1);
    //             focus.style('opacity', 1);
    //         };

    //         let mousemove = function (event) {

    //             let xPos = event.clientX - margins.left;
    //             let x0 = Math.floor(xScale.invert(event.clientX)); // returns the invert of the value?
    //             let i = bisect(dataPoints, x0);


    //             let selectedData = dataPoints[i];
    //             focus.attr('cx', xScale(selectedData.xValue)).attr('cy', yScale(selectedData.yValue));
    //             line.attr("x1", xPos).attr("x2", xPos);
    //         };

    //         let mouseout = function () {
    //             focus.style('opacity', 0);
    //             line.style('opacity', 0);
    //         };

    //         chart.on('mouseover', mouseover).on('mousemove', mousemove).on('mouseout', mouseout);

    //     } catch (error) {
    //         console.log('Issue with ruler:', error);
    //     }
    // }



    public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstance[] | VisualObjectInstanceEnumerationObject {
        const objectName = options.objectName;
        const colorPalette = this.host.colorPalette;
        let objectEnumeration: VisualObjectInstance[] = [];
        try {
            let yCount: number = this.dataview.metadata.columns.filter(x => { return x.roles.y_axis }).length;
            let metadataColumns: DataViewMetadataColumn[] = this.dataview.metadata.columns;
            switch (objectName) {
                case Settings.plotSettings:
                case Settings.enableAxis:
                    setObjectEnumerationColumnSettings(yCount, metadataColumns);
                    break;
                case Settings.colorSelector:
                    break;
                case Settings.verticalRulerSettings:
                    console.log("test");
                    let objects = this.dataview.metadata.objects;
                    objectEnumeration.push({
                        objectName: objectName,
                        properties: {
                            fill: getVerticalRulerColor(objects,colorPalette,'#000000'),
                        },
                        selector: null
                    });
                    break;
            }
        } catch (error) {
            console.log('Error in Object Enumeration: ', error);
        }
        return objectEnumeration;

        function setObjectEnumerationColumnSettings(yCount: number, metadataColumns: powerbi.DataViewMetadataColumn[]) {

            objectEnumeration = new Array<VisualObjectInstance>(yCount);
            for (let column of metadataColumns) {
                if (column.roles.y_axis) {
                    const columnObjects = column.objects;
                    //index that the column has in the plot (differs from index in metadata) and is used to have the same order in settings
                    const yIndex: number = column['rolesIndex']['y_axis'][0];
                    let properties;
                    if (objectName === Settings.plotSettings) {
                        properties = {
                            plotType: PlotType[getValue<string>(columnObjects, Settings.plotSettings, PlotSettingsNames.plotType, PlotType.LinePlot)],
                            fill: getPlotFillColor(columnObjects, colorPalette, '#000000')
                        }
                    } else if (objectName === Settings.enableAxis) {
                        properties = {
                            enabled: getValue<boolean>(columnObjects, Settings.enableAxis, EnableAxisNames.enabled, true)
                        };
                    }
                    objectEnumeration[yIndex] = {
                        objectName: objectName,
                        displayName: column.displayName,
                        properties: properties,
                        selector: { metadata: column.queryName },
                    };
                }
            }
        }
    }
}
function filterNullValues(dataPoints: DataPoint[]) {
    dataPoints = dataPoints.filter(d => { return d.yValue != null; });
    return dataPoints;
}

