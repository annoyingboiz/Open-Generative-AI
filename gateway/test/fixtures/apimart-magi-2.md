> ## Documentation Index
> Fetch the complete documentation index at: https://docs.apimart.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# MAGI-2 Video Generation

> Generate video from text, first and last frames, or image, video and audio references. Fixed 1080p output, 4–30 seconds, with audio enabled by default.

```bash cURL theme={null}
curl --request POST \
  --url https://api.apimart.ai/v1/videos/generations \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
  "model": "magi-2",
  "prompt": "A red paper boat drifts along a gutter on a rainy night, macro camera, with the sound of rain",
  "duration": 5,
  "aspect_ratio": "9:16",
  "generate_audio": true,
  "nsfw_check": true
}'
```

```python Python theme={null}
import requests

payload = {
  "model": "magi-2",
  "prompt": "A red paper boat drifts along a gutter on a rainy night, macro camera, with the sound of rain",
  "duration": 5,
  "aspect_ratio": "9:16",
  "generate_audio": True,
  "nsfw_check": True
}
response = requests.post(
    "https://api.apimart.ai/v1/videos/generations",
    headers={"Authorization": "Bearer <token>"},
    json=payload,
    timeout=60,
)
response.raise_for_status()
print(response.json())
```

```javascript JavaScript theme={null}
const payload = {
  "model": "magi-2",
  "prompt": "A red paper boat drifts along a gutter on a rainy night, macro camera, with the sound of rain",
  "duration": 5,
  "aspect_ratio": "9:16",
  "generate_audio": true,
  "nsfw_check": true
};
const response = await fetch("https://api.apimart.ai/v1/videos/generations", {
  method: "POST",
  headers: {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});
if (!response.ok) throw new Error(await response.text());
console.log(await response.json());
```

```json 200 theme={null}
{
  "code": 200,
  "data": [
    {
      "status": "submitted",
      "task_id": "task_example_magi2"
    }
  ]
}
```

MAGI-2 is a video generation model from Sand AI. Submit to `POST /v1/videos/generations`, read `data[0].task_id`, then use the [task status API](https://docs.apimart.ai/en/api-reference/tasks/status.md) to retrieve the result.

**Authorization** `string` *required*

Use `Authorization: Bearer <token>`, where `<token>` is your APIMart API key.

## Generation modes

| Mode | How to submit |
| - | - |
| Text-to-video | Provide `prompt` without image, video or audio inputs. |
| Image-to-video | Use `image_urls` for the first frame and optional last frame, or use the dedicated frame fields. |
| Reference-to-video | `video_urls`, `audio_urls`, or images with `role: "reference_image"` automatically select reference mode. With only `image_urls`, explicitly set `omni_reference_task_type: "reference"` to treat them as references. |

The input materials determine the mode first. Automatically selected reference mode behaves the same as explicit `reference`. In reference mode, all images are references; images in `image_urls` and entries with `role: "reference_image"` in `image_with_roles` share a **combined limit of 10 images**.

The reference examples explicitly set `omni_reference_task_type: "reference"`. Describe the purpose of each input in the prompt. References guide generation; source videos are not spliced into the output and source audio is not preserved verbatim.

## Request parameters

**model** `string` *required*

`magi-2`

**nsfw\_check** `boolean` (default: false)

Whether to run content moderation before submitting the video task.

* `true`: use `omni-moderation-latest` to review prompts and input images
* `false` or omitted: do not send a moderation request, adding no moderation cost or latency (default)

**prompt** `string` *required*

Required in all three modes, up to 15,000 characters. Describe the scene, action, camera and sound; put spoken dialogue in quotation marks.

**duration** `integer` (default: 5)

Whole seconds from `4` to `30`, default `5`. Explicit `0`, fractional values and out-of-range values return HTTP 400. Omit this field to use the default.

**seconds** `integer`

Alias for `duration`. If both are sent, their values must match.

**resolution** `string` (default: 1080p)

Only `1080p` is supported; omitting the field also produces 1080p. Other values return HTTP 400.

**aspect\_ratio** `string`

Text-to-video and reference-to-video support `16:9` (default), `9:16`, `1:1`, `4:3`, `3:4` and `21:9`. Image-to-video supports the first five ratios, excluding `21:9`; omit the field or use `auto` to follow the first frame’s aspect ratio. Output resolution remains 1080p.

**generate\_audio** `boolean` (default: true)

Whether to generate audio, default `true`. Set to `false` for output without an audio track. If `audio` is also sent, the values must match.

**audio** `boolean`

Alias for `generate_audio`; the values must not conflict. Send reference audio through `audio_urls`.

**seed** `integer`

An integer from `0` to `2147483647`. Omit it or send `-1` for a random seed. A fixed seed can make results with identical parameters more similar, but does not guarantee identical output.

**omni\_reference\_task\_type** `string` (default: auto)

Supports `auto` (default) and `reference`. Explicitly set `reference` when using multiple `image_urls` as reference images. `edit` and `extend` are unsupported.

**image\_urls** `string[]`

Each item must be a public HTTP(S) image URL. The 2-image limit applies only to image-to-video: the first frame and optional last frame. This mode applies when only images are supplied, with no reference video or audio, no explicit `reference`, and no `reference_image` role. In reference mode, this entire array contains references and shares a combined limit of 10 with `reference_image` entries in `image_with_roles`, whether the mode is selected automatically or explicitly.

**first\_frame\_image** `string`

Public HTTP(S) URL of the first frame. Choose either the dedicated frame fields or `image_urls`.

**last\_frame\_image** `string`

Optional public HTTP(S) URL of the last frame, used together with a first frame. Choose either the dedicated frame fields or `image_urls`.

**image\_with\_roles** `object[]`

Each item contains `url` (a public HTTP(S) image URL) and `role`: `first_frame`, `last_frame` or `reference_image`. Image-to-video allows at most one first frame and one last frame. The `reference_image` role selects reference mode; these images and those in `image_urls` share a combined limit of 10.

**video\_urls** `string[]`

Up to 5 reference videos, each 2–30 seconds, with a combined duration of at most 30 seconds recommended; the upstream service may truncate excess duration. Use an array of public HTTP(S) URLs. The singular `video_url` field is unsupported.

**audio\_urls** `string[]`

Up to 5 reference audio clips, each 2–30 seconds, with a combined duration of at most 30 seconds recommended; the upstream service may truncate excess duration. Each item must be a public HTTP(S) URL.

## Input requirements

All inputs must use publicly accessible direct HTTP(S) URLs. Login requirements, hotlink protection or download failures can cause the task to fail. For local files, first use [image upload](https://docs.apimart.ai/en/api-reference/uploads/images.md), [video upload](https://docs.apimart.ai/en/api-reference/uploads/videos.md) or [audio upload](https://docs.apimart.ai/en/api-reference/uploads/audios.md) to obtain a URL.

## Request examples

### First and last frames

```json theme={null}
{
  "model": "magi-2",
  "prompt": "The girl slowly turns and smoothly transitions to the pose in the last frame, with soft lighting",
  "image_urls": [
    "https://example.com/start.jpg",
    "https://example.com/end.jpg"
  ],
  "duration": 5
}
```

With one image, only a first frame is supplied. Omitting `aspect_ratio` follows its aspect ratio. You may use `first_frame_image` and `last_frame_image` instead of the example’s `image_urls`.

### Image-only references

```json theme={null}
{
  "model": "magi-2",
  "prompt": "The characters from both reference images meet in the same garden, preserving their distinctive appearances",
  "image_urls": [
    "https://example.com/reference-1.jpg"
  ],
  "image_with_roles": [
    {
      "url": "https://example.com/reference-2.jpg",
      "role": "reference_image"
    }
  ],
  "omni_reference_task_type": "reference",
  "aspect_ratio": "16:9",
  "duration": 5
}
```

### Mixed image, video and audio references

```json theme={null}
{
  "model": "magi-2",
  "prompt": "Use the reference video’s camera movement, the girl’s appearance from the image and the musical style of the audio to show her walking on a beach at sunset",
  "image_urls": [
    "https://example.com/girl.jpg"
  ],
  "video_urls": [
    "https://example.com/camera.mp4"
  ],
  "audio_urls": [
    "https://example.com/bgm.mp3"
  ],
  "omni_reference_task_type": "reference",
  "aspect_ratio": "16:9",
  "duration": 8
}
```

## Task polling and results

Poll the [task status API](https://docs.apimart.ai/en/api-reference/tasks/status.md) until `completed` or `failed`. Generation usually takes several minutes and may take longer under load. A fixed waiting period alone does not mean the task failed. Stopping polling does not cancel the task.

```bash theme={null}
curl --request GET \
  --url 'https://api.apimart.ai/v1/tasks/task_example_magi2' \
  --header 'Authorization: Bearer <token>'
```

| Field | Description |
| - | - |
| `data.status` | `pending` / `processing`: in progress; `completed`: success; `failed`: failure. |
| `data.progress` | Progress from 0 to 100. |
| `data.result.videos[0].url` | Output video download URL stored on the platform; see the task API for the full result structure. |
| `data.error.message` | Failure details when the task fails. |

## Unsupported features

The following return HTTP 400 on submission: `mode`, `negative_prompt`, `watermark: true`, `camera_control`, `multi_shot` / `multi_prompt`, `element_list`, `video_list`, `voice_list`, `audio_setting`, intermediate `keyframe` inputs, `omni_reference_task_type: "edit"` / `"extend"`, singular `video_url`, and any `resolution` other than `1080p`. Video editing and extension are not available.

## Common errors

For submission failures, read `error.message`. For failures after task creation, read `data.error.message` from the task status response.

| Error message or scenario | Action |
| - | - |
| `duration must be between 4 and 30 whole seconds` | Use whole seconds from 4 to 30; omission defaults to 5. |
| `duration (5) and seconds (6) are aliases and must match` | Use matching duration aliases, or send only one. |
| `requires prompt` | Provide a prompt in all three modes. |
| `image_urls takes at most 2 images` | Use at most two frame images; explicitly set `reference` for image-only references. |
| `image-to-video only supports aspect_ratio` | Remove `21:9` for image-to-video; omit the ratio or use `auto` to follow the first frame. |
| `accepts at most 10 reference images` / `5 videos` / `5 audios` | Use at most 10 reference images, 5 videos and 5 audio clips. |
| `has no video edit / extend` / `does not support keyframes` | Remove editing, extension and intermediate-frame parameters; use `video_urls` for reference videos. |
| `always outputs 1080p` | Send only `1080p`, or omit `resolution`. |
| `audio (true) and generate_audio (false) are aliases and must match` | Use matching audio switches, or send only one. |
| `Could not download the input...` | Use public URLs that can be downloaded directly, then resubmit. |


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.