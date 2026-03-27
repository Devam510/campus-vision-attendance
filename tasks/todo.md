Problem Statement: Face scanning is occurring even when the face is not centered, and the quality of face scanning needs improvement. Fix the root cause of these two problems to ensure scanning only happens when the face is at the center and the whole process is robust.

1. [x] **Plan & Analyze**: Investigate how centering is validated (or not) in the frontend `FaceScanModal.jsx` and the backend image processing WebSocket (`websocket.py` or equivalent).
2. [x] **Enforce Centering in Backend/Frontend**: Define strict bounding box thresholds (e.g., face center must be within X% of the frame center) before accepting a frame for quality evaluation.
3. [x] **Improve Face Quality Logic**: Review the face quality evaluation logic (`face_quality.py`) to reject sharp but poorly illuminated or unaligned faces.
4. [x] **Integrate UI Feedback**: Provide clear feedback to the user when they are not centered (e.g., "Move Face to Center").
5. [ ] **Verification**: Successfully register a face through the Admin panel only when properly centered and well-lit.

Risk / uncertainty flags:
- Changing the centering threshold might make it too difficult to register if set too strict.
- Need to ensure we don't block legitimate registration due to minor head movements.
