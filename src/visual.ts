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
import { getAxisTextFillColor, getPlotFillColor, getValue } from './objectEnumerationUtility';
import { createTooltipServiceWrapper, ITooltipServiceWrapper } from 'powerbi-visuals-utils-tooltiputils';
import { ViewModel, DataPoint, PlotModel } from './chartInterface';
import { visualTransform } from './parseAndTransform';

type Selection<T1, T2 = T1> = d3.Selection<any, T1, any, T2>;
export class Visual implements IVisual {
    private host: IVisualHost;
    private element: HTMLElement;
    private visualContainer: d3.Selection<HTMLDivElement, any, HTMLDivElement, any>;
    private tooltipServiceWrapper: ITooltipServiceWrapper;

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
            left: 30,
        },
    };

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.element = options.element;
        this.tooltipServiceWrapper = createTooltipServiceWrapper(this.host.tooltipService, this.element);

        this.visualContainer = d3.select(this.element).append('div').attr('class', 'visualContainer');
    }


    // TODO #3: Add x and y labels
    // TODO #5: Add code for scatterplot
    // TODO #6: Use same axis for displaying values
    // TODO #7: Align the values
    // TODO #8: Add vertical ruler
    // TODO #9: Add zooming option with a specified bin

    public update(options: VisualUpdateOptions) {
        try {
            this.dataview = options.dataViews[0];
            this.visualContainer.selectAll('*').remove();

            this.viewModel = visualTransform(options, this.host);

            let linesDots: d3.Selection<SVGCircleElement, DataPoint, any, any>[] = [];
            let lineCharts: any[] = [];
            let bars: d3.Selection<SVGRectElement, DataPoint, any, any>; // TODO #1

            for (let plotModel of this.viewModel.plotModels) {
                if (plotModel.plotSettings.plotSettings.plotType == 'line') {
                    let lines =this.drawLineChart(options, plotModel, plotModel.plotId, plotModel.xName, plotModel.yName)
                    lineCharts.push(lines);
                    linesDots.push(lines.points);
                }
                else if (plotModel.plotSettings.plotSettings.plotType == 'scatter') {
                    let lines = this.drawDots(options, plotModel, plotModel.plotId, plotModel.xName, plotModel.yName);
                    lineCharts.push(lines);
                    linesDots.push(lines.points);
                }

                else if (plotModel.plotSettings.plotSettings.plotType == 'bar') {
                    bars = this.drawBarChart(options, plotModel, plotModel.plotId, plotModel.xName, plotModel.yName);
                }
            }

            // assuming only one viewmodel exists

            for (let lineChart of lineCharts) {
                this.drawVerticalRuler(lineChart.chart, this.viewModel[0].dataPoints, lineChart.xAxis, lineChart.xScale, lineChart.yScale);
            }

            // Add Tooltips
            for (let lineDots of linesDots) {
                this.tooltipServiceWrapper.addTooltip(
                    lineDots,
                    (datapoint: DataPoint) => this.getTooltipData(datapoint),
                    (datapoint: DataPoint) => datapoint.identity
                );
            }

            // this.tooltipServiceWrapper.addTooltip(
            //     bars,
            //     (datapoint: DataPoint) => this.getTooltipData(datapoint),
            //     (datapoint: DataPoint) => datapoint.identity
            // );
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
        const chart: Selection<any> = this.visualContainer
            .append('svg')
            .classed(plotType + plotNr, true)
            .attr('width', width)
            .attr('height', height)
            .append('g')
            .attr('transform', 'translate(' + Visual.Config.margins.left + ',' + Visual.Config.margins.top + ')');

        const xAxis = chart.append('g').classed('xAxis', true);
        const yAxis = chart.append('g').classed('yAxis', true);

        if (plotModel.formatSettings.enableAxis.enabled) {
            let margins = Visual.Config.margins;
            height -= margins.bottom;
        }

        let margins = Visual.Config.margins;
        height -= margins.bottom;

        const xScale = scaleLinear().domain([0, plotModel.xRange.max]).range([0, width]);

        const xAxisValue = axisBottom(xScale);

        xAxis
            .attr('transform', 'translate(0, ' + height + ')')
            .call(xAxisValue)
            .attr(
                'color',
                getAxisTextFillColor(
                    colorObjects,
                    this.host.colorPalette,
                    '#000000' // can be defaultSettings.enableAxis.fill
                )
            );

        const xAxisLabel = chart
            .append('text')
            .attr('class', 'xLabel')
            .attr('text-anchor', 'end')
            .attr('x', width / 2)
            .attr('y', height + 20)
            .text(xLabel);

        const yScale = scaleLinear().domain([0, plotModel.yRange.max]).range([height, 0]);
        const yAxisValue = axisLeft(yScale);

        yAxis.call(yAxisValue).attr(
            'color',
            getAxisTextFillColor(
                colorObjects,
                this.host.colorPalette,
                '#000000' // can be defaultSettings.enableAxis.fill
            )
        );

        const yAxisLabel = chart
            .append('text')
            .attr('class', 'yLabel')
            .attr('text-anchor', 'middle')
            .attr('y', 0 - Visual.Config.margins.left + 30)
            .attr('x', 0 - height / 2)
            .attr('dy', '1em')
            .attr('transform', 'rotate(-90)')
            .text(yLabel);

        return {
            chart: chart,
            xScale: xScale,
            yScale: yScale,
            xAxis: xAxis,
        };
    }

    private drawLineChart(options: VisualUpdateOptions, viewModel: PlotModel, visualNumber: number, xLabel?: string, yLabel?: string): any {
        // d3.Selection<SVGCircleElement, DataPoint, any, any> // fix return type
        try {
            let result = {};
            const chartInfo = this.getChartElement(options, viewModel, xLabel, yLabel);
            const lineChart = chartInfo.chart;
            const xScale = chartInfo.xScale;
            const yScale = chartInfo.yScale;
            const xAxis = chartInfo.xAxis;
            const dataPoints = viewModel.dataPoints;

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
                .attr('stroke', 'steelblue')
                .attr('stroke-width', 1.5);

            const dots = lineChart
                .selectAll('dots')
                .data(dataPoints)
                .enter()
                .append('circle')
                .attr('fill', 'red')
                .attr('stroke', 'none')
                .attr('cx', (d) => xScale(<number>d.xValue))
                .attr('cy', (d) => yScale(<number>d.yValue))
                .attr('r', 3);

            // vertical ruler
            // lineChart.append('line').attr('stroke', 'steelblue').attr('class', 'verticalLine').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 200);
            // let bisect = d3.bisector((d: DataPoint) => <number>d.xValue).left;
            // let focus = lineChart.append('circle').style('fill', 'none').attr('stroke', 'black').attr('r', 8.5).style('opacity', 0);

            // let mouseover = function () {
            //     focus.style('opacity', 1);
            // };

            // let mousemove = function (event) {
            //     debugger;
            //     console.log('mousemoved');
            //     let x0 = xAxis.invert(event.clientX);
            //     let i = bisect(dataPoints, x0, 1);
            //     let selectedData = dataPoints[i];
            //     focus.attr('cx', xScale(selectedData.xValue)).attr('cy', yScale(selectedData.yValue));
            // };

            // let mouseout = function () {
            //     focus.style('opacity', 0);
            // };

            // lineChart.append('rect').style('fill', 'none').style('pointer-events', 'all').on('mouseover', mouseover).on('mousemove', mousemove).on('mouseout', mouseout);

            result = { chart: lineChart, points: dots, xScale: xScale, yScale: yScale, xAxis: xAxis };
            return result;
        } catch (error) {
            console.log('Error in Draw Line Chart: ', error);
        }
    }

    private drawDots(options: VisualUpdateOptions, plotModel: PlotModel, visualNumber: number, xLabel?: string, yLabel?: string): any {
        try {
            let result = {};
            const chartInfo = this.getChartElement(options, plotModel, xLabel, yLabel);
            const lineChart = chartInfo.chart;
            const xScale = chartInfo.xScale;
            const yScale = chartInfo.yScale;
            const xAxis = chartInfo.xAxis;
            const dataPoints = plotModel.dataPoints;

            // lineChart
            //     .append('path')
            //     .datum(dataPoints)
            //     .attr(
            //         'd',
            //         d3
            //             .line<DataPoint>()
            //             .x((d) => xScale(<number>d.xValue))
            //             .y((d) => yScale(<number>d.yValue))
            //     )
            //     .attr('fill', 'none')
            //     .attr('stroke', 'steelblue')
            //     .attr('stroke-width', 1.5);
            const dots = lineChart
                .selectAll('dots')
                .data(dataPoints)
                .enter()
                .append('circle')
                .attr('fill', plotModel.plotSettings.plotSettings.fill)
                .attr('stroke', 'none')
                .attr('cx', (d) => xScale(<number>d.xValue))
                .attr('cy', (d) => yScale(<number>d.yValue))
                .attr('r', 3);

            result = { chart: dots, points: dots, xScale: xScale, yScale: yScale, xAxis: xAxis };
            return result;
        } catch (error) {
            console.log('Error in Draw Line Chart: ', error);
        }
    }

    private drawBarChart(
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
        const dataPoints = plotModel.dataPoints;
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

    private drawVerticalRuler(chart: any, dataPoints: DataPoint[], xAxis: any, xScale: any, yScale: any) {
        try {
            // let verticalLine = chart.append('line').attr('stroke', 'steelblue').attr('class', 'verticalLine').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 200);

            // chart
            //     .on('mousemove', (event) => {
            //         d3.select('.verticalLine').attr('transform', () => {
            //             return 'translate(' + event.clientX + ',0)';
            //         });
            //     })
            //     .on('mouseover', (event) => {
            //         d3.select('.verticalLine').attr('transform', () => {
            //             return 'translate(' + event.clientX + ',0)';
            //         });
            //     });

            // debugger;

            console.log('Datapoints', dataPoints);
            let bisect = d3.bisector((d: DataPoint) => <number>d.xValue).left;
            let focus = chart.append('circle').style('fill', 'none').attr('stroke', 'black').attr('r', 8.5).style('opacity', 0);

            let mouseover = function () {
                focus.style('opacity', 1);
            };

            let mousemove = function (event) {
                let x0 = Math.floor(xScale.invert(event.clientX)); // returns the invert of the value?
                console.log('x0 ', x0);
                let i = bisect(dataPoints, x0);
                console.log('Index ', i, ' DataPoint at index ', dataPoints[i - 1]);

                let selectedData = dataPoints[i];
                focus.attr('cx', xScale(selectedData.xValue)).attr('cy', yScale(selectedData.yValue));
            };

            let mouseout = function () {
                focus.style('opacity', 0);
            };

            chart.on('mouseover', mouseover).on('mousemove', mousemove).on('mouseout', mouseout);

            // chart.append('rect').style('fill', 'none').style('pointer-events', 'all').on('mouseover', mouseover).on('mousemove', mousemove).on('mouseout', mouseout);
        } catch (error) {
            console.log('Issue with ruler:', error);
        }
    }

    //TODO only shows the categories and values nothing from the tooltip field
    private getTooltipData(value: any): VisualTooltipDataItem[] {
        return [
            {
                displayName: value.xValue.toString(),
                value: value.yValue.toString(),
                color: value.color ?? '#000000',
            },
        ];
    }

    // TODO: this should be able to handle the object enumeration for all the plots
    public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstance[] | VisualObjectInstanceEnumerationObject {
        let objectName = options.objectName;
        let objectEnumeration: VisualObjectInstance[] = [];

        try {
            let yCount: number = this.dataview.metadata.columns.filter(x => { return x.roles.y_axis }).length;
            let metadataColumns: DataViewMetadataColumn[] = this.dataview.metadata.columns;
            switch (objectName) {
                case 'plotSettings':
                    objectEnumeration = new Array<VisualObjectInstance>(yCount);
                    for (let i = 0; i < metadataColumns.length; i++) {
                        let column: DataViewMetadataColumn = metadataColumns[i];
                        if (column.roles.y_axis) {
                            let columnObjects = column.objects;
                            let yIndex: number = column['rolesIndex']['y_axis'][0];

                            objectEnumeration[yIndex] = {
                                objectName: objectName,
                                displayName: column.displayName,
                                properties: {
                                    plotType: getValue<string>(columnObjects, 'plotSettings', 'plotType', 'line'),
                                    fill: getPlotFillColor(columnObjects, this.host.colorPalette, '#000000')
                                },
                                selector: { metadata: column.queryName },
                            };
                        }
                    }
                    break;

                case 'enableAxis':
                    objectEnumeration = new Array<VisualObjectInstance>(yCount);
                    for (let i = 0; i < metadataColumns.length; i++) {
                        let column: DataViewMetadataColumn = metadataColumns[i];
                        if (column.roles.y_axis) {
                            let columnObjects = column.objects;
                            let yIndex: number = column['rolesIndex']['y_axis'][0];
                            objectEnumeration[yIndex] = {
                                objectName: objectName,
                                displayName: column.displayName,
                                properties: {
                                    enabled: getValue<boolean>(columnObjects, 'enableAxis', 'enabled', true)
                                },
                                selector: { metadata: column.queryName },
                            };
                        }
                    }
                    break;

                // case 'test':
                //     objectEnumeration.push({
                //         objectName: objectName,

                //                 properties: {
                //                     testType: getValue<string>(this.dataview.metadata.objects, 'test', 'testType', 'dashed')
                //                     // show2: getValue<boolean>(columnObjects, 'enableAxis', 'show2', true),//false,
                //                     // fill: getValue<string>(columnObjects, 'enableAxis', 'fill', '#000000')
                //                 },
                //                 selector: null,
                //     });
                case 'colorSelector':
                    // for (let barDataPoint of this.barDataPoints) {
                    //     objectEnumeration.push({
                    //         objectName: objectName,
                    //         displayName: barDataPoint.category,
                    //         properties: {
                    //             fill: {
                    //                 solid: {
                    //                     color: barDataPoint.color,
                    //                 },
                    //             },
                    //         },
                    //         propertyInstanceKind: {
                    //             fill: VisualEnumerationInstanceKinds.ConstantOrRule,
                    //         },
                    //         altConstantValueSelector: (<ISelectionId>barDataPoint.identity).getSelector(),
                    //         selector: dataViewWildcard.createDataViewWildcardSelector(
                    //             dataViewWildcard.DataViewWildcardMatchingOption.InstancesAndTotals
                    //         ),
                    //     });
                    // }
                    break;
            }
        } catch (error) {
            console.log('Error in Object Enumeration: ', error);
        }
        return objectEnumeration;
    }
    private persist() {

        let objects: powerbi.VisualObjectInstancesToPersist = {
            merge: [
                <VisualObjectInstance>{
                    objectName: "dumpObject",
                    selector: undefined,
                    properties: {
                        "dumpProperty": "dump"
                    }
                }]
        };

        this.host.persistProperties(objects);
    }
}
