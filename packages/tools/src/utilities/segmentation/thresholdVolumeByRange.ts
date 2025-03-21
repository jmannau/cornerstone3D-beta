import type { Types } from '@cornerstonejs/core';
import { triggerSegmentationDataModified } from '../../stateManagement/segmentation/triggerSegmentationEvents';
import type { BoundsIJK } from '../../types';
import type { ThresholdInformation } from './utilities';
import { getVoxelOverlap, processVolumes } from './utilities';

export type ThresholdRangeOptions = {
  overwrite: boolean;
  segmentationId: string;
  boundsIJK: BoundsIJK;
  overlapType?: number;
  segmentIndex?: number;
};

/**
 * It thresholds a segmentation volume based on a set of threshold values with
 * respect to a list of volumes and respective threshold ranges.
 * @param segmentationVolume - the segmentation volume to be modified
 * @param thresholdVolumeInformation - array of objects containing volume data
 * and a range (lower and upper values) to threshold
 * @param options - the options for thresholding
 * As there is a chance the volumes might have different dimensions and spacing,
 * could be the case of no 1 to 1 mapping. So we need to work with the idea of
 * voxel overlaps (1 to many mappings). We consider all intersections valid, to
 * avoid the complexity to calculate a minimum voxel intersection percentage.
 * This function, given a voxel center and spacing, calculates the overlap of
 * the voxel with another volume and range check the voxels in the overlap.
 * Three situations can occur: all voxels pass the range check, some voxels pass
 * or none voxels pass. The overlapType parameter indicates if the user requires
 * all voxels pass (overlapType = 1) or any voxel pass (overlapType = 0)
 *
 * @returns segmented volume
 */
function thresholdVolumeByRange(
  segmentationVolume: Types.IImageVolume,
  thresholdVolumeInformation: ThresholdInformation[],
  options: ThresholdRangeOptions
): Types.IImageVolume {
  const { imageData: segmentationImageData } = segmentationVolume;

  const { overwrite, boundsIJK, segmentationId } = options;
  if (!segmentationId) {
    throw new Error(
      'Segmentation ID is required to be passed inside thresholdVolumeByRange as options'
    );
  }
  const overlapType = options?.overlapType || 0;
  const segVoxelManager =
    segmentationVolume.voxelManager as Types.IVoxelManager<number>;
  const scalarDataLength =
    segmentationVolume.voxelManager.getScalarDataLength();

  // set the segmentation to all zeros
  if (overwrite) {
    for (let i = 0; i < scalarDataLength; i++) {
      segVoxelManager.setAtIndex(i, 0);
    }
  }

  const { baseVolumeIdx, volumeInfoList } = processVolumes(
    segmentationVolume,
    thresholdVolumeInformation
  );

  // global variables used in callbackOverlap function
  let overlaps, total, range;

  const testOverlapRange = (volumeInfo, voxelSpacing, voxelCenter) => {
    /**
     * This callback function will test all overlaps between a voxel in base
     * volume (the reference for segmentation volume creation) and voxels in other
     * volumes.
     */
    const callbackOverlap = ({ value }) => {
      total = total + 1;
      if (value >= range.lower && value <= range.upper) {
        overlaps = overlaps + 1;
      }
    };

    const { imageData, dimensions, lower, upper } = volumeInfo;

    const overlapBounds = getVoxelOverlap(
      imageData,
      dimensions,
      voxelSpacing,
      voxelCenter
    );

    // reset global variables and setting the range check
    total = 0;
    overlaps = 0;
    range = { lower, upper };

    let overlapTest = false;

    const { voxelManager } = imageData.get('voxelManager');
    // check all voxel overlaps
    voxelManager.forEach(callbackOverlap, {
      imageData,
      boundsIJK: overlapBounds,
    });

    if (overlapType === 0) {
      overlapTest = overlaps > 0; // any voxel overlap is accepted
    } else if (overlapType == 1) {
      overlapTest = overlaps === total; // require all voxel overlaps
    }
    return overlapTest;
  };

  // range checks a voxel in a volume with same dimension as the segmentation
  const testRange = (volumeInfo, pointIJK) => {
    const { imageData, lower, upper } = volumeInfo;
    const voxelManager = imageData.get('voxelManager').voxelManager;
    const offset = voxelManager.toIndex(pointIJK);

    const value = voxelManager.getAtIndex(offset);
    if (value <= lower || value >= upper) {
      return false;
    } else {
      return true;
    }
  };

  /**
   * This callback function will test all overlaps between a voxel in base
   * volume (the reference for segmentation volume creation) and voxels in other
   * volumes.
   */
  const callback = ({ index, pointIJK, pointLPS }) => {
    let insert = volumeInfoList.length > 0;
    for (let i = 0; i < volumeInfoList.length; i++) {
      // if volume has the same size as segmentation volume, just range check
      if (volumeInfoList[i].volumeSize === scalarDataLength) {
        insert = testRange(volumeInfoList[i], pointIJK);
      } else {
        // if not, need to calculate overlaps
        insert = testOverlapRange(
          volumeInfoList[i],
          volumeInfoList[baseVolumeIdx].spacing,
          pointLPS
        );
      }
      if (!insert) {
        break;
      }
    }

    if (insert) {
      segVoxelManager.setAtIndex(index, options.segmentIndex || 1);
    }
  };

  const voxelManager = segmentationVolume.voxelManager;

  voxelManager.forEach(callback, {
    imageData: segmentationImageData,
    boundsIJK,
  });

  triggerSegmentationDataModified(options.segmentationId);

  return segmentationVolume;
}

export default thresholdVolumeByRange;
