/**
 * Lazy entry of the 3D view. Loaded with a dynamic import() the first time the
 * card shows `view_mode: 3d`, so classic-only dashboards never download Three.js.
 */
import { defineView, VIEW_TAG } from './ui/view';

defineView();

export { VIEW_TAG };
