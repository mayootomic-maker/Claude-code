import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// Chromium is provided by the environment; Remotion must not download its own.
Config.setChromiumOpenGlRenderer('swangle');
