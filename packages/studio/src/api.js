import { getModelById, getVideoModelById, getI2IModelById, getI2VModelById, getV2VModelById, getRecastModelById, getLipSyncModelById, getAudioModelById, getMotionControlModelById } from './models.js';
import {
    buildVideoToolPayload,
    serializeVideoToolOptions,
} from './videoToolCapabilities.js';
import { buildImageSizePayload } from './imageSizing.js';
import { buildImageInputPayload, getImageInputValidationError, normalizePrimaryImageUrls } from './imageInputContracts.js';
import { pollForGenerationResult } from './utils/generationLifecycle.js';
import { getModelMediaCapabilities, mapReferenceParams } from './modelCapabilities.js';
import { buildSupplementalInputPayload } from './modelParameters.js';
import { getGroupedVideoConfiguration } from './groupedVideoModels.js';

// Every call goes to our gateway on the same origin (/api/v1/*). The gateway
// holds the provider keys and talks to APIMart / Atlas Cloud.
const BASE_URL = '';
const FILE_UPLOAD_TIMEOUT_MS = 300_000;
const FILE_UPLOAD_PENDING_PROGRESS = 99;

function notifyAuthRequired(status, detail) {
    if (typeof window === 'undefined') return;
    if (status !== 401 && status !== 403) return;
    window.dispatchEvent(new CustomEvent('dz:auth-required', { detail: { status, message: detail } }));
}

function assertRequiredPrompt(model, params) {
    if (model?.promptRequired && !String(params.prompt || '').trim()) {
        throw new Error('Prompt is required for this model.');
    }
}

function includeRequiredArrayDefaults(model, payload) {
    const defaults = {};
    for (const field of model?.required || []) {
        if (payload[field] !== undefined || model?.inputs?.[field]?.type !== 'array') continue;
        defaults[field] = [];
    }
    return Object.keys(defaults).length > 0 ? { ...defaults, ...payload } : payload;
}

async function pollForResult(requestId, key, maxAttempts = 900, interval = 2000) {
    return pollForGenerationResult({
        baseUrl: BASE_URL,
        requestId,
        apiKey: key,
        maxAttempts,
        interval,
        onAuthRequired: notifyAuthRequired,
    });
}

function normalizePredictionResult(submitData, result, outputUrl) {
    const requestId = submitData?.request_id || submitData?.id || result?.request_id || result?.id;
    return {
        ...result,
        ...(requestId ? { request_id: requestId } : {}),
        url: outputUrl,
    };
}

// DZ: pass as `onRequestId` to any generate*/process* call to get the price of
// that exact request instead of running it: resolves to { usd, exact, source }.
export const DZ_QUOTE = Symbol('dz-quote');

// DZ: no time limit in the browser. The job lives on the server until the
// provider finishes (queues can take tens of minutes); we poll every 2 s.
const POLL_ATTEMPTS = (6 * 3600) / 2;

async function quoteRequest(endpoint, payload) {
    const response = await fetch(`${BASE_URL}/dz/api/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, body: payload }),
    });
    if (!response.ok) return null;
    return (await response.json()).price || null;
}

// DZ: which studio a request comes from, plus the studio's own settings
// (camera, lens…) to keep with the history item. Set around a generate* call:
//   dzWithMeta({ studio: 'image' }, () => generateImage(apiKey, params))
// generate* functions reach submitAndPoll synchronously, so the value is read
// before the first await. The gateway stores it and never sends it on.
let DZ_CURRENT_META = null;
export function dzWithMeta(meta, fn) {
    const previous = DZ_CURRENT_META;
    DZ_CURRENT_META = meta;
    try { return fn(); } finally { DZ_CURRENT_META = previous; }
}
function dzNotify(detail) {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('dz:history', { detail }));
}

async function submitAndPoll(endpoint, payload, key, onRequestId, maxAttempts = POLL_ATTEMPTS) {
    const dz = DZ_CURRENT_META;
    if (onRequestId === DZ_QUOTE) return quoteRequest(endpoint, payload);
    maxAttempts = Math.max(maxAttempts, POLL_ATTEMPTS);
    const url = `${BASE_URL}/api/v1/${endpoint}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify(dz ? { ...payload, _dz: dz } : payload)
    });
    if (!response.ok) {
        const errText = await response.text();
        notifyAuthRequired(response.status, errText);
        throw new Error(`API Request Failed: ${response.status} ${response.statusText} - ${errText.slice(0, 100)}`);
    }
    const submitData = await response.json();
    const requestId = submitData.request_id || submitData.id;
    if (!requestId) return submitData;
    if (typeof onRequestId === 'function') onRequestId(requestId);
    dzNotify({ id: requestId, status: 'processing', studio: dz?.studio || null });
    let result;
    try {
        result = await pollForResult(requestId, key, maxAttempts);
    } finally {
        dzNotify({ id: requestId, status: 'done', studio: dz?.studio || null });
    }
    const outputUrl = result.outputs?.[0] || result.url || result.output?.url;
    return normalizePredictionResult(submitData, result, outputUrl);
}

export async function generateImage(apiKey, params) {
    const modelInfo = getModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const payload = {
        ...buildSupplementalInputPayload(modelInfo, params),
        prompt: params.prompt
    };
    if (modelInfo) Object.assign(payload, buildImageSizePayload(modelInfo, params.aspect_ratio));
    else if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.resolution) payload.resolution = params.resolution;
    if (params.quality) payload.quality = params.quality;
    if (params.image_url) { 
        payload.image_url = params.image_url; 
        payload.strength = params.strength || 0.6; 
    } else if (params.images_list) {
        payload.images_list = params.images_list;
    } else {
        payload.image_url = null;
    }
    if (params.seed && params.seed !== -1) payload.seed = params.seed;
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId);
}

export async function generateI2I(apiKey, params) {
    const modelInfo = getI2IModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const imageField = modelInfo?.imageField || 'image_url';
    const imagesList = normalizePrimaryImageUrls(params.images_list, params.image_url);
    const inputError = getImageInputValidationError(modelInfo, 'i2i', {
        prompt: params.prompt,
        primaryImageUrls: imagesList,
        auxiliaryImageUrls: params,
    });
    if (inputError) throw new Error(inputError);
    const payload = {
        ...mapReferenceParams(modelInfo, params),
        ...buildSupplementalInputPayload(modelInfo, params),
        ...buildImageInputPayload(modelInfo, 'i2i', params)
    };
    if (imagesList.length > 0) {
        if (imageField === 'images_list') payload.images_list = imagesList;
        // DZ: array fields (e.g. image_urls) are already filled with all images by mapReferenceParams
        else if (!Array.isArray(payload[imageField])) payload[imageField] = imagesList[0];
    }
    if (modelInfo) Object.assign(payload, buildImageSizePayload(modelInfo, params.aspect_ratio));
    else if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.resolution) payload.resolution = params.resolution;
    if (params.quality) payload.quality = params.quality;
    if (modelInfo?.inputs?.name) {
        payload.name = params.name || modelInfo.inputs.name.default;
    }
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId);
}

export async function decomposeLayers(apiKey, params) {
    const endpoint = 'bytedance-seedream-5.0-pro-layer';
    const payload = {
        image_url: params.image_url,
        prompt: params.prompt || '',
        resolution: params.resolution || 'auto',
        output_format: params.output_format || 'png'
    };
    const result = await submitAndPoll(endpoint, payload, apiKey, params.onRequestId);
    const rawImages = result.images || result.output?.images || result.outputs || (result.url ? [result.url] : []);
    const images = Array.isArray(rawImages) ? rawImages : [rawImages];
    return { ...result, images };
}

export async function generateVideo(apiKey, params) {
    const modelInfo = getVideoModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const mediaCapabilities = getModelMediaCapabilities(modelInfo);
    assertRequiredPrompt(modelInfo, params);
    let payload = {
        ...mapReferenceParams(modelInfo, params),
        ...buildSupplementalInputPayload(modelInfo, params)
    };
    if (params.prompt) payload.prompt = params.prompt;
    if (params.request_id) payload.request_id = params.request_id;
    if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.duration) payload.duration = params.duration;
    if (params.resolution) payload.resolution = params.resolution;
    if (typeof params.generate_audio === 'boolean') payload.generate_audio = params.generate_audio;
    if (params.quality) payload.quality = params.quality;
    if (params.mode) payload.mode = params.mode;
    if (!mediaCapabilities.image.field && params.image_url) payload.image_url = params.image_url;
    if (!mediaCapabilities.image.field && params.images_list?.length > 0) payload.images_list = params.images_list;
    if (!mediaCapabilities.video.field && params.videos_list?.length > 0) payload.videos_list = params.videos_list;
    if (!mediaCapabilities.video.field && params.video_files?.length > 0) payload.video_files = params.video_files;
    Object.assign(payload, serializeVideoToolOptions(modelInfo, params.options));
    payload = includeRequiredArrayDefaults(modelInfo, payload);
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId);
}

export async function generateI2V(apiKey, params) {
    const modelInfo = getI2VModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    assertRequiredPrompt(modelInfo, params);
    let payload = {
        ...mapReferenceParams(modelInfo, params),
        ...buildSupplementalInputPayload(modelInfo, params)
    };
    if (params.prompt) payload.prompt = params.prompt;
    if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.duration) payload.duration = params.duration;
    if (params.resolution) payload.resolution = params.resolution;
    if (typeof params.generate_audio === 'boolean') payload.generate_audio = params.generate_audio;
    if (params.quality) payload.quality = params.quality;
    if (params.mode) payload.mode = params.mode;
    if (modelInfo?.inputs?.name) {
        payload.name = params.name || modelInfo.inputs.name.default;
    }
    payload = includeRequiredArrayDefaults(modelInfo, payload);
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId);
}

export async function generateMarketingStudioAd(apiKey, params) {
    const endpoint = params.resolution === '1080p' ? 'sd-2-vip-omni-reference-1080p' : 'seedance-2-vip-omni-reference';
    const payload = {
        prompt: params.prompt,
        aspect_ratio: params.aspect_ratio || '16:9',
        duration: params.duration || 5,
        images_list: params.images_list || [],
        video_files: params.video_files || []
    };
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId);
}

export async function processV2V(apiKey, params) {
    const modelInfo = getV2VModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const toolPayload = buildVideoToolPayload(modelInfo, params);
    let payload = {
        ...buildSupplementalInputPayload(modelInfo, params),
        ...toolPayload,
        ...mapReferenceParams(modelInfo, params),
    };
    if (modelInfo?.hasPrompt && params.prompt) {
        payload.prompt = params.prompt;
    }
    if (getGroupedVideoConfiguration(modelInfo?.id)) {
        for (const field of ['duration', 'aspect_ratio', 'resolution', 'quality']) {
            if (modelInfo.inputs?.[field] && params[field] !== undefined) {
                payload[field] = params[field];
            }
        }
    }
    payload = includeRequiredArrayDefaults(modelInfo, payload);
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId);
}

export async function processRecast(apiKey, params) {
    const modelInfo = getRecastModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const videoField = modelInfo?.videoField || 'video_url';
    const payload = { [videoField]: params.video_url };
    if (modelInfo?.imageField && params.image_url) {
        payload[modelInfo.imageField] = params.image_url;
    }
    if (modelInfo?.hasPrompt && params.prompt) {
        payload.prompt = params.prompt;
    }
    if (params.aspect_ratio) {
        payload.aspect_ratio = params.aspect_ratio;
    }
    if (params.character_orientation) {
        payload.character_orientation = params.character_orientation;
    }
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId);
}

export async function processMotionControl(apiKey, params) {
    const model = params.model || 'seedance-2.5-motion-control';
    const mode = params.mode || 'motion_transfer';
    const internalPrompt = mode === 'objects_swap'
        ? "Keep the rest of the scene as filmed, swap the characters, products, or clothes with the reference images."
        : "Extract motion from the reference video and rebuild the scene with the new characters and assets, preserving the original motion, choreography, and camera movements.";

    const userPrompt = String(params.prompt || '').trim();
    const finalPrompt = userPrompt ? `${internalPrompt} ${userPrompt}` : internalPrompt;

    let imagesList = [];
    if (Array.isArray(params.images_list)) {
        imagesList = params.images_list;
    } else if (params.images) {
        imagesList = Array.isArray(params.images) ? params.images : [params.images];
    } else if (params.image_url) {
        imagesList = [params.image_url];
    }

    let duration = Number(params.duration) || 5;

    const payload = {
        video_url: params.video_url,
        images_list: imagesList,
        aspect_ratio: params.aspect_ratio || '16:9',
        duration: duration,
        generate_audio: !!params.generate_audio,
        prompt: finalPrompt
    };

    if (model === 'seedance-2-motion-control') {
        if (payload.duration > 15) payload.duration = 15;
        if (payload.duration < 4) payload.duration = 4;
        if (payload.images_list.length > 9) payload.images_list = payload.images_list.slice(0, 9);
        payload.quality = params.quality === 'basic' ? 'basic' : 'high';
        if (params.seed !== undefined && params.seed !== -1) payload.seed = Number(params.seed);
    } else {
        if (payload.duration > 30) payload.duration = 30;
        if (payload.duration < 4) payload.duration = 4;
        if (payload.images_list.length > 30) payload.images_list = payload.images_list.slice(0, 30);
        payload.high_bitrate = !!params.high_bitrate;
        if (params.seed !== undefined && params.seed !== -1) payload.seed = Number(params.seed);
    }

    return submitAndPoll(model, payload, apiKey, params.onRequestId);
}

export async function processLipSync(apiKey, params) {
    const modelInfo = getLipSyncModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const payload = {};
    if (params.audio_url) payload.audio_url = params.audio_url;
    if (params.image_url) payload.image_url = params.image_url;
    if (params.video_url) payload.video_url = params.video_url;
    if (modelInfo?.hasPrompt) payload.prompt = params.prompt || '';
    if (params.resolution) payload.resolution = params.resolution;
    if (params.seed !== undefined && params.seed !== -1) payload.seed = params.seed;
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId);
}

export async function generateAudio(apiKey, params) {
    const modelId = params._modelId || params.model;
    const modelInfo = getAudioModelById(modelId);
    const endpoint = modelInfo?.endpoint || modelId;
    const payload = {};
    const skipKeys = ['_modelId', 'onRequestId'];
    for (const key in params) {
        if (!skipKeys.includes(key) && params[key] !== undefined && params[key] !== null) {
            payload[key] = params[key];
        }
    }
    return submitAndPoll(endpoint, payload, apiKey, params.onRequestId);
}

export function uploadFile(apiKey, file, onProgress) {
    return new Promise((resolve, reject) => {
        const url = `${BASE_URL}/api/v1/upload_file`;
        const formData = new FormData();
        formData.append('file', file);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.setRequestHeader('x-api-key', apiKey);
        xhr.timeout = FILE_UPLOAD_TIMEOUT_MS;

        if (onProgress) {
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentComplete = Math.min(
                        Math.round((event.loaded / event.total) * 100),
                        FILE_UPLOAD_PENDING_PROGRESS
                    );
                    onProgress(percentComplete);
                }
            };
        }

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    const fileUrl = data.url || data.file_url || data.data?.url;
                    if (!fileUrl) {
                        reject(new Error('No URL returned from file upload'));
                    } else {
                        onProgress?.(100);
                        resolve(fileUrl);
                    }
                } catch (e) {
                    reject(new Error('Failed to parse upload response'));
                }
            } else {
                let detail = xhr.statusText;
                try {
                    const errObj = JSON.parse(xhr.responseText);
                    detail = errObj.detail || detail;
                } catch (e) {
                    // fallback to statusText
                }
                notifyAuthRequired(xhr.status, detail);
                reject(new Error(`File upload failed: ${xhr.status} - ${detail}`));
            }
        };

        xhr.onerror = () => reject(new Error('Network error during file upload'));
        xhr.ontimeout = () => reject(new Error('File upload timed out. Please try again.'));
        xhr.send(formData);
    });
}

// DZ: Topaz upscaling on fal.ai. `endpoint` is a tool endpoint from the
// catalog (e.g. topaz/upscale/image/precision); the rest goes to the model.
export async function dzUpscale(apiKey, { endpoint, onRequestId, ...params }) {
    return submitAndPoll(`p/fal/${endpoint}`, params, apiKey, onRequestId);
}

export async function upscaleImage(apiKey, { model, image_url, resolution, upscale_factor, onRequestId }) {
    let endpoint = model;
    let payload = { image_url };
    if (model === "seedvr2-image-upscale") {
        payload.resolution = resolution || "4k";
    } else if (model === "topaz-image-upscale") {
        payload.upscale_factor = Number(upscale_factor) || 2;
    } else if (model === "ai-image-upscaler") {
        endpoint = "ai-image-upscale";
    }
    return submitAndPoll(endpoint, payload, apiKey, onRequestId);
}

export async function removeBackground(apiKey, { image_url, onRequestId }) {
    const endpoint = "ai-background-remover";
    const payload = { image_url };
    return submitAndPoll(endpoint, payload, apiKey, onRequestId);
}

export async function expandImage(apiKey, { image_url, onRequestId }) {
    const endpoint = "ai-image-extension";
    const payload = { image_url };
    return submitAndPoll(endpoint, payload, apiKey, onRequestId);
}
