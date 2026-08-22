# CapstoneProject---iPeek-updated-
# Research Repository & AI Analysis System

## Project Overview

iPeek is a centralized ISAT-U research repository with authenticated browsing,
PDF viewing, research submission workflows, OTP-protected account registration,
and AI-assisted similarity, summary, gap, and chatbot features.

The application has two parts:

- `frontend/` contains the browser pages, styles, and JavaScript API client.
- `backend/` contains the FastAPI service, SQLite database, ChromaDB vector
        store, authentication, ingestion, and AI services.

## Running Locally

Start the API from the `backend/` directory:

```powershell
python -m uvicorn main:app --reload
```

Serve `frontend/` through a local web server on port `5500`, for example with
the VS Code Live Server extension. The frontend API client expects the backend
at `http://localhost:8000` and CORS is configured for `localhost:5500` and
`127.0.0.1:5500`.

The backend requires a `.env` file containing at least `GROQ_API_KEY`. OTP
email delivery additionally requires `SMTP_USERNAME` and `SMTP_PASSWORD`.
`LIBRARIAN_EMAILS` is a comma-separated allowlist of staff addresses that
should receive the librarian role.

Install backend dependencies with:

```powershell
pip install -r requirements.txt
```

## Authentication and Registration

Authentication uses JWT bearer tokens. On successful login, the token is kept
in `sessionStorage` under `ipeek_token` and attached by `frontend/js/api.js` to
protected API requests. The backend remains authoritative for the user's role;
display values in `sessionStorage` are not used for access control.

New accounts use a two-step registration flow:

1. The user submits their name, institutional email, department, and password.
2. The backend generates a six-digit OTP, stores only its SHA-256 hash, and
         emails the code.
3. The frontend verifies the OTP and then submits the registration details.
4. The backend creates the account only after that email is verified.

Only `@students.isatu.edu.ph` and `@isatu.edu.ph` addresses are accepted.
Student, faculty, and librarian roles are derived server-side from the email
domain and librarian allowlist. OTPs expire after 10 minutes and are limited
to five incorrect attempts; requesting a new code invalidates older pending
codes.

The OTP flow is coordinated by `frontend/js/login.js` and implemented by
`backend/services/otp_service.py` and `backend/routers/auth_routes.py`.

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

This prevents the frontend from intentionally waiting for one analysis to
finish before starting the next one. The requests are still separate backend
requests, so parallel browser calls do not yet eliminate duplicate retrieval
and reranking work.

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

The current RAG pipeline for each analysis is:

```text
embed query -> ChromaDB vector search -> CrossEncoder reranking -> Groq generation
```

The current configuration retrieves 10 candidates and keeps the top 5. The
reranker is `BAAI/bge-reranker-v2-m3` through
`sentence-transformers.CrossEncoder`, running CPU-bound inference in a worker
thread. The embedding service uses FastEmbed, but the reranker has not yet
been migrated to an ONNX implementation.

Groq generation is configured with the `openai/gpt-oss-120b` model in
`backend/config.py`.

Because similarity, summary, and gap analysis each call the RAG service
independently, opening a paper can repeat embedding, vector search, and
reranking up to three times. `Promise.all()` overlaps those requests, but it
does not remove the duplicate backend work.

---

## Possible Performance Improvements

Further improvements can be made to reduce AI response times.

### 1. Reduce the amount of text sent to Groq

Large prompts and large research documents can increase processing time.

The backend should send only the information that the model actually needs.

### 2. Limit the number of documents used for similarity analysis

Similarity analysis can become expensive if the backend sends a very large number of research papers to the model.

A smaller candidate set can significantly reduce processing time. This has
already been applied: `RETRIEVAL_TOP_K` is `10` in `backend/config.py`, down
from `20`, while the reranker keeps the top `5`.

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

This is already implemented in the `AIAnalysis` database table. Cached
similarity, summary, and gap results are reused by `research_id`, survive
server restarts, and are cleared when the underlying paper changes.

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

The database cache avoids repeated Groq generations on later visits. A future
combined analysis endpoint could also avoid repeated retrieval and reranking
on the first visit by retrieving once and sharing the context across the three
generations. That change is not yet implemented.

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
- OTP email verification before account creation
- Server-derived student, faculty, and librarian roles
- JWT API adapter for authenticated frontend requests

The main remaining performance considerations are measuring each pipeline stage,
avoiding duplicate first-visit retrieval/reranking, and optionally migrating
the CrossEncoder reranker from PyTorch to a supported ONNX implementation.

---

## Main Files Updated

### Authentication and API

The authentication work spans:

- `frontend/index.html` and `frontend/js/login.js` for login, registration,
        OTP entry, resend, and account-creation states.
- `frontend/js/api.js` for login, JWT storage, protected requests, OTP
        requests, OTP verification, and registration calls.
- `backend/routers/auth_routes.py` for login, profile, OTP, and registration
        endpoints.
- `backend/services/otp_service.py` for code generation, hashing, expiry,
        attempt limits, email delivery, and role derivation.
- `backend/models.py`, `backend/schemas.py`, and `backend/config.py` for the
        OTP table, request/response models, SMTP settings, and role configuration.

`backend/routers/ai_routes.py` also permits faculty accounts to use the AI
analysis and chatbot endpoints, alongside students and librarians.

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