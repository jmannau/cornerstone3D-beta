import type { Types } from '@cornerstonejs/core';

type Statistics = {
  name: string;
  label?: string;
  value: number | number[];
  unit: null | string;
  pointIJK?: Types.Point3;
  pointLPS?: Types.Point3;
};

type NamedStatistics = {
  mean: Statistics & { name: 'mean' };
  max: Statistics & { name: 'max' };
  min: Statistics & { name: 'min' };
  stdDev: Statistics & { name: 'stdDev' };
  count: Statistics & { name: 'count' };
  area?: Statistics & { name: 'area' };
  volume?: Statistics & { name: 'volume' };
  circumference?: Statistics & { name: 'circumference' };
  pointsInShape?: Types.IPointsManager<Types.Point3>;
  /**
   * A set of stats callback arguments containing maximum values.
   * This can be used to test peak intensities in the areas.
   */
  maxIJKs?: Array<{ value: number; pointIJK: Types.Point3 }>;
  array: Statistics[];
};

export type { Statistics, NamedStatistics };
