import { getEnabledElement, triggerEvent } from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';

import Events from '../../enums/Events';
import mouseMoveListener from './mouseMoveListener';
import type { EventTypes, IPoints } from '../../types';
import getMouseEventPoints from './getMouseEventPoints';

const { MOUSE_DOWN, MOUSE_DOWN_ACTIVATE, MOUSE_CLICK, MOUSE_UP, MOUSE_DRAG } =
  Events;

// The amount of time in milliseconds within which a browser 'dblclick' event has to occur.
// Any mouse down, up, down and up sequence taking longer than this time is considered to
// NOT be a double click and any browser 'dblclick' event that subsequently occurs as a result
// of such a sequence will be ignored. It is best to set this to a value that is less
// than the system value for detecting a double click. Setting something too large
// might detect a double click that does not constitute a browser 'dblclick' and thus
// no mouse events for the sequence will get fired at all.
//
// TODO This module should detect and fire 'dblclick' events at its discretion and
// ignore all those generated by the browser.
//
const DOUBLE_CLICK_TOLERANCE_MS = 400;

// This tolerance is how long to accept a secondary button down
const MULTI_BUTTON_TOLERANCE_MS = 150;

// A drag (projected distance) during the double click timeout that is greater than this
// value will cancel the timeout and suppress any double click that might occur.
// This tolerance is particularly important on touch devices where some movement
// might occur between the two clicks.
//
// TODO revisit this value for touch devices
//
const DOUBLE_CLICK_DRAG_TOLERANCE = 3;

interface IMouseDownListenerState {
  mouseButton: number;
  element: HTMLDivElement;
  renderingEngineId: string;
  viewportId: string;
  isClickEvent: boolean;
  clickDelay: number;
  preventClickTimeout: ReturnType<typeof setTimeout>;
  startPoints: IPoints;
  lastPoints: IPoints;
}

interface IDoubleClickState {
  doubleClickTimeout: ReturnType<typeof setTimeout>;
  mouseDownEvent: MouseEvent;
  mouseUpEvent: MouseEvent;
  ignoreDoubleClick: boolean;
}

// STATE
const defaultState: IMouseDownListenerState = {
  mouseButton: undefined,
  //
  element: null,
  renderingEngineId: undefined,
  viewportId: undefined,
  //
  isClickEvent: true,
  clickDelay: 200,
  preventClickTimeout: null,
  startPoints: {
    page: [0, 0],
    client: [0, 0],
    canvas: [0, 0],
    world: [0, 0, 0],
  },
  lastPoints: {
    page: [0, 0],
    client: [0, 0],
    canvas: [0, 0],
    world: [0, 0, 0],
  },
};

let state: IMouseDownListenerState = {
  mouseButton: undefined,
  //
  renderingEngineId: undefined,
  viewportId: undefined,
  //
  isClickEvent: true,
  clickDelay: 200,
  element: null,
  preventClickTimeout: null,
  startPoints: {
    page: [0, 0],
    client: [0, 0],
    canvas: [0, 0],
    world: [0, 0, 0],
  },
  lastPoints: {
    page: [0, 0],
    client: [0, 0],
    canvas: [0, 0],
    world: [0, 0, 0],
  },
};

const doubleClickState: IDoubleClickState = {
  doubleClickTimeout: null,
  mouseDownEvent: null,
  mouseUpEvent: null,
  ignoreDoubleClick: false,
};

/**
 * Listens to mouse down events from the DOM and depending on interaction and further
 * interaction can emit the following mouse events:
 *
 * - MOUSE_DOWN
 * - MOUSE_DOWN_ACTIVATE
 * - MOUSE_DRAG (move while down)
 * - MOUSE_UP
 * - MOUSE_CLICK
 *
 * The mouse down is NOT handled immediately. Instead, a timeout is started to
 * determine if this mouse down is the first in a sequence that constitutes a
 * double click.
 *
 * @param evt - The Mouse event.
 * @private
 */
function mouseDownListener(evt: MouseEvent) {
  if (doubleClickState.doubleClickTimeout) {
    // A second identical click will be a double click event, so ignore it
    if (evt.buttons === doubleClickState.mouseDownEvent.buttons) {
      return;
    }

    // Record the second button or the changed button event as the initial
    // button down state so that the multi-button event can be detected
    doubleClickState.mouseDownEvent = evt;

    // If second button is added, then ensure double click timeout is terminated
    // and do not handle three or more button gestures.
    _doStateMouseDownAndUp();
    return;
  }

  // Handle multi-button clicks by adding a delay before handling them.
  // Double clicks (left button only) physically take the user longer, so
  // use a longer timeout, and for multi-button at the same time, the clicks
  // are done at the same time by the user, just the system perceives them
  // separately, so have a short timeout to allow catching both buttons.
  doubleClickState.doubleClickTimeout = setTimeout(
    _doStateMouseDownAndUp,
    evt.buttons === 1 ? DOUBLE_CLICK_TOLERANCE_MS : MULTI_BUTTON_TOLERANCE_MS
  );

  // First mouse down of a potential double click. So save it and start
  // a timeout to determine a double click.
  doubleClickState.mouseDownEvent = evt;
  doubleClickState.ignoreDoubleClick = false;

  state.element = <HTMLDivElement>evt.currentTarget;

  state.mouseButton = evt.buttons;

  const enabledElement = getEnabledElement(state.element);
  const { renderingEngineId, viewportId } = enabledElement;

  state.renderingEngineId = renderingEngineId;
  state.viewportId = viewportId;

  state.preventClickTimeout = setTimeout(
    _preventClickHandler,
    state.clickDelay
  );

  // Prevent CornerstoneToolsMouseMove while mouse is down
  state.element.removeEventListener('mousemove', mouseMoveListener);

  const startPoints = getMouseEventPoints(evt, state.element);
  state.startPoints = _copyPoints(startPoints);
  state.lastPoints = _copyPoints(startPoints);

  document.addEventListener('mouseup', _onMouseUp);
  document.addEventListener('mousemove', _onMouseDrag);
}

/**
 * Does the actual mouse down logic if the double click timer has expired or
 * a mouse drag has started.
 * @param evt the mouse down event
 * @private
 */
function _doMouseDown(evt: MouseEvent) {
  const deltaPoints = _getDeltaPoints(state.startPoints, state.startPoints);

  const eventDetail: EventTypes.MouseDownEventDetail = {
    event: evt,
    eventName: MOUSE_DOWN,
    element: state.element,
    mouseButton: state.mouseButton,
    renderingEngineId: state.renderingEngineId,
    viewportId: state.viewportId,
    camera: {},
    startPoints: state.startPoints,
    lastPoints: state.startPoints,
    currentPoints: state.startPoints,
    deltaPoints,
  };

  state.lastPoints = _copyPoints(eventDetail.lastPoints);

  // by triggering MOUSE_DOWN it checks if this is toolSelection, handle modification etc.
  // of already existing tools
  const notConsumed = triggerEvent(
    eventDetail.element,
    MOUSE_DOWN,
    eventDetail
  );

  // if no tools responded to this event and prevented its default behavior,
  // create a new tool
  if (notConsumed) {
    triggerEvent(eventDetail.element, MOUSE_DOWN_ACTIVATE, eventDetail);
  }
}

/**
 *_onMouseDrag - Handle emission of drag events whilst the mouse is depressed.
 *
 * @private
 * @param evt - The mouse event.
 */
function _onMouseDrag(evt: MouseEvent) {
  const enabledElement = getEnabledElement(state.element);
  if (!enabledElement?.viewport) {
    return;
  }
  const currentPoints = getMouseEventPoints(evt, state.element);
  const lastPoints = _updateMouseEventsLastPoints(
    state.element,
    state.lastPoints
  );

  const deltaPoints = _getDeltaPoints(currentPoints, lastPoints);

  if (doubleClickState.doubleClickTimeout) {
    if (_isDragPastDoubleClickTolerance(deltaPoints.canvas)) {
      // Dragging past the tolerance means no double click should occur.
      _doStateMouseDownAndUp();
    } else {
      return;
    }
  }

  const eventDetail: EventTypes.MouseDragEventDetail = {
    event: evt,
    eventName: MOUSE_DRAG,
    mouseButton: state.mouseButton,
    renderingEngineId: state.renderingEngineId,
    viewportId: state.viewportId,
    camera: {},
    element: state.element,
    startPoints: _copyPoints(state.startPoints),
    lastPoints: _copyPoints(lastPoints),
    currentPoints,
    deltaPoints,
  };

  const consumed = !triggerEvent(state.element, MOUSE_DRAG, eventDetail);

  // Events.MOUSE_DRAG was consumed, thus no other listener should handle this event.
  if (consumed) {
    evt.stopImmediatePropagation();
    evt.preventDefault();
  }

  // Update the last points
  state.lastPoints = _copyPoints(currentPoints);
}

/**
 *_onMouseUp - Handle emission of mouse up events, and re-enabling mouse move events.
 *
 * If the mouse up event occurs during a double click timeout, it is either the first or
 * second mouse up of a potential double click sequence. If the first, then it
 * is saved in case the double click timeout expires and a simple mouse down and
 * up have to get executed. If the second, then the latest mouse down, up, down and
 * up constitute a double click and the mouseDoubleClickListener needs to execute.
 *
 * If the mouse up event comes after the double click timeout, then it is simply
 * handled as the up of a mouse down and up sequence.
 *
 * @private
 * @param evt - The mouse event.
 */
function _onMouseUp(evt: MouseEvent): void {
  // Cancel the timeout preventing the click event from triggering
  clearTimeout(state.preventClickTimeout);

  if (doubleClickState.doubleClickTimeout) {
    // received a mouse up while waiting for a double click (via a timeout)

    if (!doubleClickState.mouseUpEvent) {
      // this is the first mouse up during the double click timeout; we'll need it later if the timeout expires
      doubleClickState.mouseUpEvent = evt;

      state.element.addEventListener('mousemove', _onMouseMove);
    } else {
      // this is the second mouse up of a double click!
      _cleanUp();
    }
  } else {
    // Handle the actual mouse up. Note that it may have occurred during the double click timeout or
    // after it expired. In either case this block is being executed after the time out has expired
    // or after a drag started.

    const eventName = state.isClickEvent ? MOUSE_CLICK : MOUSE_UP;

    const currentPoints = getMouseEventPoints(evt, state.element);
    const deltaPoints = _getDeltaPoints(currentPoints, state.lastPoints);

    const eventDetail:
      | EventTypes.MouseUpEventDetail
      | EventTypes.MouseClickEventType = {
      event: evt,
      eventName,
      mouseButton: state.mouseButton,
      element: state.element,
      renderingEngineId: state.renderingEngineId,
      viewportId: state.viewportId,
      camera: {},
      startPoints: _copyPoints(state.startPoints),
      lastPoints: _copyPoints(state.lastPoints),
      currentPoints,
      deltaPoints,
    };

    triggerEvent(eventDetail.element, eventName, eventDetail);

    _cleanUp();
  }

  // Remove the drag as soon as we get the mouse up because either we have executed
  // the mouse up logic, or we have not even handled the mouse down logic yet
  // - either way no drag should/can occur.
  document.removeEventListener('mousemove', _onMouseDrag);
}

/**
 * Handles a mouse move on the state element after a mouse down AND up AND
 * while the double click timeout is still running.
 * @private
 * @param evt - The mouse event.
 */
function _onMouseMove(evt: MouseEvent) {
  const currentPoints = getMouseEventPoints(evt, state.element);
  const lastPoints = _updateMouseEventsLastPoints(
    state.element,
    state.lastPoints
  );

  const deltaPoints = _getDeltaPoints(currentPoints, lastPoints);

  if (!_isDragPastDoubleClickTolerance(deltaPoints.canvas)) {
    return;
  }

  _doStateMouseDownAndUp();

  // Do the move again because during the timeout the global mouse move listener was removed.
  // Now it is back.
  mouseMoveListener(evt);
}

/**
 * Determines if the given delta is past the double click, (projected) drag distance
 * tolerance.
 * @param delta the delta
 * @returns true iff the delta is past the tolerance
 */
function _isDragPastDoubleClickTolerance(delta: Types.Point2): boolean {
  return Math.abs(delta[0]) + Math.abs(delta[1]) > DOUBLE_CLICK_DRAG_TOLERANCE;
}

function _preventClickHandler() {
  state.isClickEvent = false;
}

/**
 * Do a mouse down and potential mouse up using each of the events in the double click state.
 * The events were stored in the state during the timeout to determine a double click.
 *
 * This function should be invoked whenever it is determined that the latest
 * sequence of mouse down(s) and up(s) is NOT a double click. Examples of this include
 * - the expiration of the double click timeout
 * - a mouse drag/move beyond the DOUBLE_CLICK_DRAG_TOLERANCE
 *
 * This function sets the doubleClickState.ignoreDoubleClick flag in case our timeout value
 * or mouse move/drag tolerance is inaccurate and we do indeed get a double click event from
 * the browser later. The flag will be cleared in the mouseDoubleClickIgnoreListener should a
 * double click event get fired. If there is no eventual double click for the latest sequence,
 * the flag spills into the next sequence where it will get cleared at the beginning of that next
 * sequence in mouseDownListener. It is perfectly safe for the flag to be
 * left true when no double click actually occurs because any future double click must start with
 * a mouse down that is handled in this module.
 *
 * @private
 */
function _doStateMouseDownAndUp() {
  doubleClickState.ignoreDoubleClick = true;

  const mouseDownEvent = doubleClickState.mouseDownEvent;
  const mouseUpEvent = doubleClickState.mouseUpEvent;

  _clearDoubleClickTimeoutAndEvents();

  _doMouseDown(mouseDownEvent);

  if (mouseUpEvent) {
    _onMouseUp(mouseUpEvent);
  }
}

/**
 * Clears the mouse events and double click timeout id in the double click state object.
 * The timeout itself is also cleared so that no callback is invoked.
 */
function _clearDoubleClickTimeoutAndEvents() {
  if (doubleClickState.doubleClickTimeout) {
    clearTimeout(doubleClickState.doubleClickTimeout);
    doubleClickState.doubleClickTimeout = null;
  }

  doubleClickState.mouseDownEvent = null;
  doubleClickState.mouseUpEvent = null;
}

function _cleanUp() {
  document.removeEventListener('mouseup', _onMouseUp);
  state.element?.removeEventListener('mousemove', _onMouseMove);

  // Restore our global mousemove listener
  state.element?.addEventListener('mousemove', mouseMoveListener);

  _clearDoubleClickTimeoutAndEvents();

  state = JSON.parse(JSON.stringify(defaultState));
}

/**
 * Copies a set of points.
 * @param points - The `IPoints` instance to copy.
 *
 * @returns A copy of the points.
 */
function _copyPoints(points: IPoints): IPoints {
  return JSON.parse(JSON.stringify(points));
}

/**
 * Recalculates the last world coordinate, as the linear transform from client
 * to world could be different if the camera was updated.
 * @param element - The HTML element
 * @param lastPoints - The last points
 */
function _updateMouseEventsLastPoints(
  element: HTMLDivElement,
  lastPoints: IPoints
): IPoints {
  const { viewport } = getEnabledElement(element) || {};

  if (!viewport) {
    return lastPoints;
  }
  // Need to update the world point to be calculated from the current reference frame,
  // Which might have changed since the last interaction.
  const world = viewport.canvasToWorld(lastPoints.canvas);

  return {
    page: lastPoints.page,
    client: lastPoints.client,
    canvas: lastPoints.canvas,
    world,
  };
}

/**
 * Returns the difference between two `IPoints` instances.
 * @param currentPoints - The current points.
 * @param lastPoints -- The last points, to be subtracted from the `currentPoints`.
 *
 * @returns The difference in IPoints format
 */
function _getDeltaPoints(currentPoints: IPoints, lastPoints: IPoints): IPoints {
  if (!currentPoints || !lastPoints) {
    return {
      page: [0, 0],
      client: [0, 0],
      canvas: [0, 0],
      world: [0, 0, 0],
    };
  }

  return {
    page: _subtractPoints2D(currentPoints.page, lastPoints.page),
    client: _subtractPoints2D(currentPoints.client, lastPoints.client),
    canvas: _subtractPoints2D(currentPoints.canvas, lastPoints.canvas),
    world: _subtractPoints3D(currentPoints.world, lastPoints.world),
  };
}

/**
 * _subtractPoints - Subtracts `point1` from `point0`.
 * @param point0 - The first point.
 * @param point1 - The second point to subtract from the first.
 *
 * @returns The difference.
 */
function _subtractPoints2D(
  point0: Types.Point2,
  point1: Types.Point2
): Types.Point2 {
  return [point0[0] - point1[0], point0[1] - point1[1]];
}

function _subtractPoints3D(
  point0: Types.Point3,
  point1: Types.Point3
): Types.Point3 {
  return [point0[0] - point1[0], point0[1] - point1[1], point0[2] - point1[2]];
}

export function getMouseButton(): number {
  return state.mouseButton;
}

/**
 * Handles a dblclick event to determine if it should be ignored based on the
 * double click state's ignoreDoubleClick flag. stopImmediatePropagation and
 * preventDefault are used to ignore the event.
 * @param evt browser dblclick event
 */
export function mouseDoubleClickIgnoreListener(evt: MouseEvent) {
  if (doubleClickState.ignoreDoubleClick) {
    doubleClickState.ignoreDoubleClick = false;

    // Use stopImmediatePropagation to lessen the possibility that a third party 'dblclick'
    // listener receives this event. However, there still is no guarantee
    // that any third party listener has not already handled the event.
    evt.stopImmediatePropagation();
    evt.preventDefault();
  } else {
    // If the embedding application blocked the first mouse down and up
    // of a double click sequence from reaching this module, then this module
    // has handled the second mouse down and up and thus needs to clean them up.
    // Doing a clean up here for the typical double click case is harmless.
    _cleanUp();
  }
}

export default mouseDownListener;
