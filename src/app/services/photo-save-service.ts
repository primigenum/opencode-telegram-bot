import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";

/**
 * Saves a downloaded photo to the vision upload directory so the opencode
 * agent can inspect the ORIGINAL image itself (with the describe_image tool)
 * while working on the user's prompt — e.g. "implement the web with this
 * style (style.png)".
 *
 * Returns the absolute path of the saved file.
 */
export function savePhotoForAgent(
  buffer: Buffer,
  extension: string = "png",
  dir: string = config.vision.uploadDir,
): string {
  const result = Bun.spawnSync(["mkdir", "-p", dir], { stdout: "ignore", stderr: "ignore" });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create upload directory ${dir} (exit ${result.exitCode})`);
  }
  const photoPath = `${dir}/photo-${Date.now()}.${extension}`;
  Bun.write(photoPath, buffer);
  logger.info(`[Bot] Photo saved for agent inspection: ${photoPath}`);
  return photoPath;
}
