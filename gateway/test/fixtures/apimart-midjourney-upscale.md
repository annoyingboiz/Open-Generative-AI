> ## Documentation Index
> Fetch the complete documentation index at: https://docs.apimart.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Upscale

> Pick one of U1–U4 from an Imagine grid to produce a single image; composed locally and usually returns instantly

```bash cURL theme={null}
curl --request POST \
  --url https://api.apimart.ai/v1/midjourney/generations/upscale \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "task_id": "task_01KQVZAPBW13W63DQNQZT7FCQK",
    "index": 1,
    "speed": "fast"
  }'
```

```python Python theme={null}
import requests

url = "https://api.apimart.ai/v1/midjourney/generations/upscale"

payload = {
    "task_id": "task_01KQVZAPBW13W63DQNQZT7FCQK",
    "index": 1,
    "speed": "fast"
}

headers = {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
}

response = requests.post(url, json=payload, headers=headers)

print(response.json())
```

```javascript JavaScript theme={null}
const url = "https://api.apimart.ai/v1/midjourney/generations/upscale";

const payload = {
  task_id: "task_01KQVZAPBW13W63DQNQZT7FCQK",
  index: 1,
  speed: "fast"
};

const headers = {
  "Authorization": "Bearer <token>",
  "Content-Type": "application/json"
};

fetch(url, {
  method: "POST",
  headers: headers,
  body: JSON.stringify(payload)
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));
```

```go Go theme={null}
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io/ioutil"
    "net/http"
)

func main() {
    url := "https://api.apimart.ai/v1/midjourney/generations/upscale"

    payload := map[string]interface{}{
        "task_id": "task_01KQVZAPBW13W63DQNQZT7FCQK",
        "index": 1,
        "speed": "fast",
    }

    jsonData, _ := json.Marshal(payload)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    req.Header.Set("Authorization", "Bearer <token>")
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, err := client.Do(req)
    if err != nil {
        panic(err)
    }
    defer resp.Body.Close()

    body, _ := ioutil.ReadAll(resp.Body)
    fmt.Println(string(body))
}
```

```java Java theme={null}
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.URI;

public class Main {
    public static void main(String[] args) throws Exception {
        String url = "https://api.apimart.ai/v1/midjourney/generations/upscale";

        String payload = """
        {
          "task_id": "task_01KQVZAPBW13W63DQNQZT7FCQK",
          "index": 1,
          "speed": "fast"
        }
        """;

        HttpClient client = HttpClient.newHttpClient();
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .header("Authorization", "Bearer <token>")
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(payload))
            .build();

        HttpResponse<String> response = client.send(request,
            HttpResponse.BodyHandlers.ofString());

        System.out.println(response.body());
    }
}
```

```php PHP theme={null}
<?php

$url = "https://api.apimart.ai/v1/midjourney/generations/upscale";

$payload = [
    "task_id" => "task_01KQVZAPBW13W63DQNQZT7FCQK",
    "index" => 1,
    "speed" => "fast",
];

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: Bearer <token>",
    "Content-Type: application/json"
]);

$response = curl_exec($ch);
curl_close($ch);

echo $response;
?>
```

```ruby Ruby theme={null}
require 'net/http'
require 'json'
require 'uri'

url = URI("https://api.apimart.ai/v1/midjourney/generations/upscale")

payload = {
  task_id: "task_01KQVZAPBW13W63DQNQZT7FCQK",
  index: 1,
  speed: "fast",
}

http = Net::HTTP.new(url.host, url.port)
http.use_ssl = true

request = Net::HTTP::Post.new(url)
request["Authorization"] = "Bearer <token>"
request["Content-Type"] = "application/json"
request.body = payload.to_json

response = http.request(request)
puts response.body
```

```swift Swift theme={null}
import Foundation

let url = URL(string: "https://api.apimart.ai/v1/midjourney/generations/upscale")!

let payload: [String: Any] = [
    "task_id": "task_01KQVZAPBW13W63DQNQZT7FCQK",
    "index": 1,
    "speed": "fast",
]

var request = URLRequest(url: url)
request.httpMethod = "POST"
request.setValue("Bearer <token>", forHTTPHeaderField: "Authorization")
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

let task = URLSession.shared.dataTask(with: request) { data, response, error in
    if let error = error {
        print("Error: \(error)")
        return
    }
    
    if let data = data, let responseString = String(data: data, encoding: .utf8) {
        print(responseString)
    }
}

task.resume()
```

```csharp C# theme={null}
using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

class Program
{
    static async Task Main(string[] args)
    {
        var url = "https://api.apimart.ai/v1/midjourney/generations/upscale";

        var payload = @"{
            ""task_id"": ""task_01KQVZAPBW13W63DQNQZT7FCQK"",
            ""index"": 1,
            ""speed"": ""fast""
        }";

        using var client = new HttpClient();
        client.DefaultRequestHeaders.Add("Authorization", "Bearer <token>");

        var content = new StringContent(payload, Encoding.UTF8, "application/json");
        var response = await client.PostAsync(url, content);
        var result = await response.Content.ReadAsStringAsync();

        Console.WriteLine(result);
    }
}
```

```c C theme={null}
#include <stdio.h>
#include <curl/curl.h>

int main(void) {
    CURL *curl;
    CURLcode res;

    curl_global_init(CURL_GLOBAL_DEFAULT);
    curl = curl_easy_init();

    if(curl) {
        const char *url = "https://api.apimart.ai/v1/midjourney/generations/upscale";
        const char *payload = "{"
            "\"task_id\":\"task_01KQVZAPBW13W63DQNQZT7FCQK\","
            "\"index\":1,"
            "\"speed\":\"fast\""
        "}";

        struct curl_slist *headers = NULL;
        headers = curl_slist_append(headers, "Authorization: Bearer <token>");
        headers = curl_slist_append(headers, "Content-Type: application/json");

        curl_easy_setopt(curl, CURLOPT_URL, url);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, payload);
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

        res = curl_easy_perform(curl);

        if(res != CURLE_OK) {
            fprintf(stderr, "curl_easy_perform() failed: %s\n",
                    curl_easy_strerror(res));
        }

        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);
    }

    curl_global_cleanup();
    return 0;
}
```

```objectivec Objective-C theme={null}
#import <Foundation/Foundation.h>

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        NSURL *url = [NSURL URLWithString:@"https://api.apimart.ai/v1/midjourney/generations/upscale"];
        
        NSDictionary *payload = @{
            @"task_id": @"task_01KQVZAPBW13W63DQNQZT7FCQK",
            @"index": @1,
            @"speed": @"fast",
        };
        
        NSError *error;
        NSData *jsonData = [NSJSONSerialization dataWithJSONObject:payload
                                                          options:0
                                                            error:&error];
        
        NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
        [request setHTTPMethod:@"POST"];
        [request setValue:@"Bearer <token>" forHTTPHeaderField:@"Authorization"];
        [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
        [request setHTTPBody:jsonData];
        
        NSURLSessionDataTask *task = [[NSURLSession sharedSession] 
            dataTaskWithRequest:request
            completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
                if (error) {
                    NSLog(@"Error: %@", error);
                    return;
                }
                NSString *result = [[NSString alloc] initWithData:data 
                                                        encoding:NSUTF8StringEncoding];
                NSLog(@"%@", result);
            }];
        
        [task resume];
        [[NSRunLoop mainRunLoop] run];
    }
    return 0;
}
```

```ocaml OCaml theme={null}
(* Requires cohttp and yojson libraries *)
open Lwt
open Cohttp
open Cohttp_lwt_unix

let url = "https://api.apimart.ai/v1/midjourney/generations/upscale"

let payload = {|{
  "task_id": "task_01KQVZAPBW13W63DQNQZT7FCQK",
  "index": 1,
  "speed": "fast"
}|}

let () =
  let headers = Header.init ()
    |> fun h -> Header.add h "Authorization" "Bearer <token>"
    |> fun h -> Header.add h "Content-Type" "application/json"
  in
  let body = Cohttp_lwt.Body.of_string payload in
  
  let response = Client.post ~headers ~body (Uri.of_string url) >>= fun (resp, body) ->
    body |> Cohttp_lwt.Body.to_string >|= fun body_str ->
    print_endline body_str
  in
  Lwt_main.run response
```

```dart Dart theme={null}
import 'dart:convert';
import 'package:http/http.dart' as http;

void main() async {
  final url = Uri.parse('https://api.apimart.ai/v1/midjourney/generations/upscale');
  
  final payload = {
    'task_id': 'task_01KQVZAPBW13W63DQNQZT7FCQK',
    'index': 1,
    'speed': 'fast',
  };
  
  final response = await http.post(
    url,
    headers: {
      'Authorization': 'Bearer <token>',
      'Content-Type': 'application/json',
    },
    body: jsonEncode(payload),
  );
  
  print(response.body);
}
```

```r R theme={null}
library(httr)
library(jsonlite)

url <- "https://api.apimart.ai/v1/midjourney/generations/upscale"

payload <- list(
  task_id = "task_01KQVZAPBW13W63DQNQZT7FCQK",
  index = 1,
  speed = "fast"
)

response <- POST(
  url,
  add_headers(
    Authorization = "Bearer <token>",
    `Content-Type` = "application/json"
  ),
  body = toJSON(payload, auto_unbox = TRUE),
  encode = "raw"
)

cat(content(response, "text"))
```

```json 200 theme={null}
{
  "code": 200,
  "data": [
    {
      "status": "submitted",
      "task_id": "task_01KV52C0TEJSYZMCG0NCS4YWKK"
    }
  ]
}
```

```json 400 theme={null}
{
  "error": {
    "code": 400,
    "message": "Invalid request parameters",
    "type": "invalid_request_error"
  }
}
```

```json 401 theme={null}
{
  "error": {
    "code": 401,
    "message": "Invalid authentication credentials",
    "type": "authentication_error"
  }
}
```

```json 402 theme={null}
{
  "error": {
    "code": 402,
    "message": "Insufficient balance. Please top up your account",
    "type": "payment_required"
  }
}
```

```json 403 theme={null}
{
  "error": {
    "code": 403,
    "message": "Access forbidden. You don't have permission to access this resource",
    "type": "permission_error"
  }
}
```

```json 404 theme={null}
{
  "error": {
    "code": 404,
    "message": "Task not found",
    "type": "not_found_error"
  }
}
```

```json 429 theme={null}
{
  "error": {
    "code": 429,
    "message": "Rate limit exceeded. Please try again later",
    "type": "rate_limit_error"
  }
}
```

```json 500 theme={null}
{
  "error": {
    "code": 500,
    "message": "Internal server error. Please try again later",
    "type": "server_error"
  }
}
```

```json 502 theme={null}
{
  "error": {
    "code": 502,
    "message": "Bad gateway. The server is temporarily unavailable",
    "type": "bad_gateway"
  }
}
```

Picks one of U1–U4 from the parent grid (`grid_image_url`) to produce a single image. This is implemented by **cropping from the existing 4 images**, composed locally and usually returns instantly.

| Item | Value |
| - | - |
| action | `UPSCALE` |
| Billing | `midjourney@upscale[-version][-speed]` |
| Required | `task_id` + `index`, or `task_id` + `custom_id` |
| Optional | `speed`, `metadata` |

## Parameters

| Field | Type | Notes |
| - | - | - |
| `task_id` | string | Parent task ID (must be a SUCCESS imagine / variation / reroll, etc.) |
| `nsfw_check` | boolean | Optional; defaults to `false`. Run content moderation before submitting a Midjourney task. • `true`: use `omni-moderation-latest` to review prompts and input images • `false`: skip moderation without adding moderation cost or latency |
| `index` | int | Which tile (U1–U4), range `1`–`4`; one of `index` / `custom_id` |
| `custom_id` | string | Directly pass the button ID for the corresponding action; one of `index` / `custom_id`; when set, `index` matching is skipped |
| `speed` | string | `relax` / `fast` / `turbo` (no effect, since it is composed locally) |
| `metadata` | object | Custom metadata |

## Request examples

By `index`:

```json theme={null}
{
  "task_id": "task_01KQVZAPBW13W63DQNQZT7FCQK",
  "index": 1,
  "speed": "fast"
}
```

Pass a button directly:

```json theme={null}
{
  "task_id": "task_01KQVZAPBW13W63DQNQZT7FCQK",
  "custom_id": "MJ::JOB::upsample::1::xxxx"
}
```

## Response

Submission returns a new `task_id`, **usually SUCCESS within milliseconds**. On SUCCESS, `image_urls` has a single element (one image), and `buttons` contains follow-up actions (zoom / inpaint / pan / variation, etc.).

## Notes

* The parent task must be in SUCCESS state, otherwise it returns `400` (`task is not in SUCCESS state`).
* `index` must be `1`–`4`; out of range returns `400`. `custom_id` and `index` are mutually exclusive; if both are passed, `custom_id` wins.
* The resource-consuming step is imagine; upscale only picks from existing images and rarely fails.
* The single image after upscale can continue with Zoom / Inpaint / Variation.

## HD upscale (HD enlargement, outputs a single 2x image)

A regular upscale is **composed locally**—it crops one of the 4 images already in the parent task and returns instantly. If you later want to perform fine-grained operations such as zoom / inpaint on a single image, we recommend using **HD upscale** instead: it performs a real enlargement, outputs a **single 2x HD image**, takes about 60–120s to complete, and the resulting single image more reliably supports subsequent zoom / inpaint.

HD upscale specifies the enlargement command via `custom_id`; different imagine versions correspond to different commands:

| customId command | Applicable version |
| - | - |
| `upsample_v5_2x` | v5 imagine |
| `upsample_v5_4x` | v5 imagine |
| `upsample_v6_2x_subtle` | v6 / v6.1 imagine |
| `upsample_v6_2x_creative` | v6 / v6.1 imagine |
| `upsample_v7_2x_subtle` | **v7 imagine** |
| `upsample_v7_2x_creative` | v7 imagine |

### HD upscale example

```json theme={null}
{
  "task_id": "task_01KQVZAPBW13W63DQNQZT7FCQK",
  "custom_id": "MJ::JOB::upsample_v7_2x_subtle::1::xxxx"
}
```

Once complete, you get a true single 2x HD image task, which you can continue to zoom / inpaint.

### Comparison with regular upscale

| Dimension | Regular upscale | HD upscale |
| - | - | - |
| Implementation | Composed locally (cropping) | Real enlargement processing |
| Time | Millisecond-level | About 60–120s |
| Output | Picks the Nth of 4 images | **Single 2x HD image** |
| Follow-up | zoom / inpaint / variation | zoom / inpaint more reliable |

### ⚠️ pan is still unavailable

Even for the HD single image produced by HD upscale, **pan operations are still rejected** (returns "invalid image generation request")—this is a Midjourney limitation on the pan operation itself, unrelated to the enlargement method. See [Pan](https://docs.apimart.ai/en/api-reference/images/midjourney/pan.md) for details.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.