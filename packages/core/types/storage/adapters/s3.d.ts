/**
 * @param {Object} config
 * @param {string} config.bucket
 * @param {string} [config.endpoint] - omit for AWS S3
 * @param {string} [config.region] - 'auto' for R2
 * @param {string} config.accessKeyId
 * @param {string} config.secretAccessKey
 * @param {string} [config.sessionToken]
 * @param {string} [config.publicUrl] - CDN or custom domain
 * @param {boolean} [config.forcePathStyle] - inferred when not set
 * @returns {Object} storage adapter
 */
export function createS3Adapter(config?: {
    bucket: string;
    endpoint?: string;
    region?: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    publicUrl?: string;
    forcePathStyle?: boolean;
}): any;
