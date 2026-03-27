# Project Lessons & Rules

## [2026-03-27] — Windows cv2 Camera Initialization (obsensor bug) → Multi-backend Fallback
**Pattern:** Using `cv2.VideoCapture(0)` on Windows laptops often fails with `obsensor_uvc_stream_channel.cpp:163 cv::obsensor::getStreamChannelGroup Camera index out of range` or simply `Cannot open camera`. This happens because OpenCV prioritizes the obsensor (Orbbec) backend which intercepts index `0` and crashes for standard webcams.

**Rule:** NEVER use a single `cv2.VideoCapture(src)` without a fallback loop on Windows. Always try `cv2.CAP_MSMF` and `cv2.CAP_DSHOW` before falling back to `cv2.CAP_ANY`.

**Implementation Example:**
```python
backends = []
if isinstance(src, int):
    if hasattr(cv2, "CAP_MSMF"): backends.append(("MSMF", cv2.CAP_MSMF))
    if hasattr(cv2, "CAP_DSHOW"): backends.append(("DirectShow", cv2.CAP_DSHOW))
backends.append(("ANY", cv2.CAP_ANY))

for backend_name, backend_flag in backends:
    cap = cv2.VideoCapture(src, backend_flag)
    if cap.isOpened():
        return cap
```
