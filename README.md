# CapstoneProject---iPeek-updated-
# Research Repository & AI Analysis System

## Changes Made Today

### Research Detail Page

Updated the Research Detail page (`detail.js`) to properly load research papers and run the AI-powered analysis features.

The following issues were fixed:

- Fixed the missing `docId` URL parameter.
- Fixed the initialization error that prevented the Research Detail page from loading.
- Added proper handling of the research ID returned from the document details API.
- Added rendering for:
  - Paper title
  - Authors
  - Department
  - Year
  - Status
  - Abstract
- Added error handling when the research paper cannot be loaded.
- Added proper loading states for AI analysis panels.
- Added the Similarity Analysis panel.
- Added the Summary panel.
- Added the Research Gaps panel.
- Added the Similar Projects panel.
- Added tab switching between Similarity, Summary, and Research Gaps.
- Added fallback rendering when the Groq AI response does not follow the expected format.

---

## AI Analysis

The Research Detail page now performs three AI analysis operations:

1. **Similarity Analysis**
2. **Research Summary**
3. **Research Gap Analysis**

These operations are triggered after the research paper has been loaded.

The requests are started in parallel using:

```javascript
await Promise.all([
  runSimilarity(),
  runSummary(),
  runGaps(),
]);
```

This prevents the frontend from intentionally waiting for one analysis to finish before starting the next one.

### Similarity Analysis

The similarity analysis:

- Sends the research ID to the backend.
- Receives the AI-generated similarity report.
- Parses `HIGH`, `MODERATE`, and `LOW` similarity levels.
- Displays similarity levels using visual progress bars.
- Displays the related/similar research projects.
- Falls back to displaying the raw AI response if the response format does not match the expected structure.

### Summary

The summary feature:

- Sends the research ID to the backend.
- Receives the AI-generated summary.
- Removes Markdown bold markers from the response.
- Displays the summary in the Summary panel.
- Uses the existing typewriter effect when available.
- Falls back to normal text rendering if the typewriter function is unavailable.

### Research Gaps

The research gap analysis:

- Sends the research ID to the backend.
- Receives AI-generated research gaps.
- Extracts:
  - Gap
  - Recommendation
  - Urgency
- Supports `HIGH`, `MEDIUM`, and `LOW` urgency levels.
- Displays each gap as a separate card.
- Falls back to displaying the raw AI response if the expected format is not returned.

---

## AI Chatbot

The Research Detail page now includes a functional AI chatbot.

### Chat Flow

When the user sends a message:

1. The message is read from the chat input.
2. Empty messages are ignored.
3. The user's message is immediately displayed in the chat.
4. The message is added to `chatHistory`.
5. A temporary `…` thinking message is displayed.
6. The question and chat history are sent to the backend using `apiChat()`.
7. The frontend waits for the AI response.
8. The temporary thinking message is replaced with the AI response.
9. The assistant response is added to `chatHistory`.

The chatbot also supports:

- Enter → Send message
- Shift + Enter → Insert a newline

Example:

```javascript
const data = await apiChat(question, chatHistory);
thinkingBubble.textContent = data.result;
chatHistory.push({
  role: "assistant",
  content: data.result
});
```

---

## Chat History

The chatbot maintains conversation history using:

```javascript
let chatHistory = [];
```

Messages are stored in the following format:

```javascript
{
  role: "user",
  content: "User question"
}
```

and:

```javascript
{
  role: "assistant",
  content: "AI response"
}
```

This allows subsequent chatbot requests to include the previous conversation context.

---

## PDF Viewer

A PDF viewer was added to the Research Detail page using PDF.js.

The PDF viewer supports:

- Opening the PDF viewer.
- Closing the PDF viewer.
- Loading the research PDF.
- Rendering individual PDF pages.
- Previous page navigation.
- Next page navigation.
- Current page display.
- PDF loading error handling.
- PDF rendering error handling.

PDF viewer state is maintained using:

```javascript
let pdfDoc = null;
let pdfPage = 1;
let pdfVisible = false;
```

The PDF is loaded using the authenticated API request:

```javascript
pdfDoc = await pdfjsLib.getDocument({
  url,
  httpHeaders: apiAuthHeaderForPdf()
}).promise;
```

The JWT authorization header is therefore used when requesting the PDF.

---

## API Request Flow

The Research Detail page currently follows this general request flow:

```text
Research Detail Page
        |
        +----> GET /auth/me
        |
        +----> GET /repository/{document}/detail
        |
        +----> AI Similarity
        |
        +----> AI Summary
        |
        +----> AI Research Gaps
        |
        +----> AI Chat
                 |
                 +----> Groq API
```

The first two requests load the authenticated user and research paper.

After the research paper is loaded, the AI analysis requests are started.

The chatbot request is triggered separately whenever the user sends a question.

---

## CORS / Preflight Behavior

During testing, the backend showed requests similar to:

```text
INFO: 127.0.0.1:57045 - "GET /auth/me HTTP/1.1" 200 OK
INFO: 127.0.0.1:57045 - "GET /repository/kdd2018illegalparking/detail HTTP/1.1" 200 OK
INFO: 127.0.0.1:63896 - "OPTIONS /ai/chat HTTP/1.1" 200 OK
```

The `OPTIONS` request is the browser's CORS preflight request.

It is important to understand that:

```text
OPTIONS /ai/chat 200 OK
```

does **not** mean that the actual AI chatbot request has completed.

The browser first performs the CORS preflight:

```text
OPTIONS /ai/chat
```

and then sends the actual request:

```text
POST /ai/chat
```

The actual `POST /ai/chat` request needs to complete successfully before the chatbot receives the Groq response.

---

## AI Response Time / Performance

During testing, the chatbot and AI analysis requests initially took several minutes to return.

The frontend was therefore sometimes left displaying a loading/thinking state while the backend was waiting for the AI response.

The current frontend starts the three research analyses in parallel:

```javascript
await Promise.all([
  runSimilarity(),
  runSummary(),
  runGaps(),
]);
```

This is preferable to doing:

```javascript
await runSimilarity();
await runSummary();
await runGaps();
```

because the second approach would force the requests to run sequentially.

With `Promise.all()`, all three requests can be in progress at the same time.

---

## Possible Performance Improvements

Further improvements can be made to reduce AI response times.

### 1. Reduce the amount of text sent to Groq

Large prompts and large research documents can increase processing time.

The backend should send only the information that the model actually needs.

### 2. Limit the number of documents used for similarity analysis

Similarity analysis can become expensive if the backend sends a very large number of research papers to the model.

A smaller candidate set can significantly reduce processing time.

### 3. Use a faster Groq model

The backend can use a faster model where high reasoning capability is not required.

The best model depends on the quality and complexity requirements of each AI feature.

### 4. Cache AI analysis results

Once a research paper has already been analyzed, the system can store:

- Summary
- Similarity analysis
- Research gaps

in the database.

When the user opens the same paper again, the backend can return the existing result instead of making another Groq request.

This can significantly reduce both response time and API usage.

### 5. Avoid unnecessary repeated requests

The frontend should avoid calling the same AI endpoint repeatedly when the result is already available.

For example:

```text
First visit
    ↓
Generate AI analysis
    ↓
Save result
    ↓
Future visits
    ↓
Return saved result
```

instead of:

```text
Every page visit
    ↓
Call Groq again
    ↓
Generate the same result
```

### 6. Add backend timeouts

The backend should have reasonable timeouts for AI requests so that a failed or stalled request does not leave the frontend waiting indefinitely.

### 7. Improve chatbot response streaming

The chatbot currently waits for the complete AI response:

```text
User sends message
        ↓
Backend sends request to Groq
        ↓
Groq generates entire response
        ↓
Backend returns response
        ↓
Frontend displays response
```

A future improvement would be streaming the response:

```text
User sends message
        ↓
Backend sends request to Groq
        ↓
Groq starts generating
        ↓
First tokens arrive
        ↓
Frontend starts displaying
        ↓
More tokens arrive
        ↓
Response continues appearing
```

This would make the chatbot **feel much faster**, even if the total generation time remains similar.

---

## Current Status

The Research Detail page now supports:

- Research paper loading
- Paper metadata rendering
- Abstract rendering
- Similarity analysis
- Similar research projects
- AI-generated summary
- AI-generated research gaps
- AI recommendations
- AI urgency classification
- Interactive analysis tabs
- AI chatbot
- Chat history
- Enter-to-send chat
- Shift+Enter for new lines
- PDF viewing
- PDF page navigation
- JWT-authenticated PDF requests
- AI error handling
- Loading states
- CORS preflight handling

The main remaining performance consideration is reducing the time required for the backend/Groq AI requests.

---

## Main Files Updated

### `detail.js`

The main Research Detail page logic was updated to include:

```text
URL parameter handling
        ↓
Research loading
        ↓
Paper rendering
        ↓
AI similarity
        ↓
AI summary
        ↓
AI research gaps
        ↓
AI chatbot
        ↓
PDF viewer
```

The frontend now properly coordinates these features and handles both successful and failed API responses.

---

## Important Note About Groq API Usage

A browser request such as:

```text
OPTIONS /ai/chat
```

is only the CORS preflight.

It should not be counted as the actual chatbot AI generation request.

The actual AI request occurs when the backend receives the real request to:

```text
POST /ai/chat
```

and then makes the corresponding request to the Groq API.

Therefore, when testing Groq API usage, the important thing to monitor is whether the backend actually reaches the Groq API and how many model-generation requests are being made.

---

## Summary of Today's Changes

Today's work focused on making the Research Detail page fully functional and connecting its AI-powered features.

### Fixed

- Missing `docId`
- Page initialization failure
- Missing rendering functions
- Missing chat functions
- Missing PDF viewer functions
- Missing PDF state variables
- AI panel loading issues
- Error handling issues

### Added

- Research information rendering
- Similarity visualization
- Similar project cards
- AI summary
- Research gap cards
- Recommendations
- Urgency labels
- Chatbot
- Chat history
- PDF viewer
- PDF navigation
- JWT-authenticated PDF loading
- AI loading states
- AI error states

### Performance

The three initial AI analyses are now started concurrently with:

```javascript
Promise.all([
  runSimilarity(),
  runSummary(),
  runGaps()
]);
```

Future optimization should focus primarily on the backend/Groq request time, caching, prompt size, model selection, and potentially streaming chatbot responses.