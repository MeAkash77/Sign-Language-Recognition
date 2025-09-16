import React, { useState, useRef, useEffect, useCallback } from "react";
import "./Detect.css";
import { v4 as uuidv4 } from "uuid";
import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";
import { drawConnectors, drawLandmarks } from "@mediapipe/drawing_utils";
import { HAND_CONNECTIONS } from "@mediapipe/hands";

import Webcam from "react-webcam";
import { SignImageData } from "../../data/SignImageData";
import { useDispatch, useSelector } from "react-redux";
import { addSignData } from "../../redux/actions/signdataaction";
import ProgressBar from "./ProgressBar/ProgressBar";

import DisplayImg from "../../assests/displayGif.gif";

let startTime = "";

const Detect = () => {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const requestRef = useRef(null);

  const [webcamRunning, setWebcamRunning] = useState(false);
  const [gestureOutput, setGestureOutput] = useState("");
  const [gestureRecognizer, setGestureRecognizer] = useState(null);
  const gestureRecognizerRef = useRef(null); // mirror for callbacks
  const [runningMode, setRunningMode] = useState("IMAGE");
  const [progress, setProgress] = useState(0);
  const [detectedData, setDetectedData] = useState([]);
  const [currentImage, setCurrentImage] = useState(null);

  const user = useSelector((state) => state.auth?.user);
  const { accessToken } = useSelector((state) => state.auth);
  const dispatch = useDispatch();

  // rotate practice images while webcam runs
  useEffect(() => {
    let intervalId = null;
    if (webcamRunning) {
      intervalId = setInterval(() => {
        const randomIndex = Math.floor(Math.random() * SignImageData.length);
        setCurrentImage(SignImageData[randomIndex]);
      }, 5000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [webcamRunning]);

  // core prediction - runs every animation frame
  const predictWebcam = useCallback(() => {
    const recognizer = gestureRecognizerRef.current;
    const webcamEl = webcamRef.current?.video;
    const canvasEl = canvasRef.current;
    if (!recognizer || !webcamEl || !canvasEl) return;

    // switch to VIDEO mode if needed
    if (runningMode === "IMAGE") {
      setRunningMode("VIDEO");
      try {
        // setOptions may or may not be present depending on version
        if (typeof recognizer.setOptions === "function") {
          recognizer.setOptions({ runningMode: "VIDEO" });
        }
      } catch (e) {
        // ignore if not supported
      }
    }

    let results;
    try {
      const nowInMs = Date.now();
      results = recognizer.recognizeForVideo(webcamEl, nowInMs);
    } catch (err) {
      console.error("recognizeForVideo error:", err);
      return;
    }

    const canvasCtx = canvasEl.getContext("2d");
    if (!canvasCtx) return;

    // set sizes
    const videoWidth = webcamEl.videoWidth || webcamEl.width || 640;
    const videoHeight = webcamEl.videoHeight || webcamEl.height || 480;
    webcamEl.width = videoWidth;
    webcamEl.height = videoHeight;
    canvasEl.width = videoWidth;
    canvasEl.height = videoHeight;

    // clear canvas
    canvasCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    // draw landmarks if available
    if (results?.landmarks) {
      for (const landmarks of results.landmarks) {
        try {
          drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {
            color: "#00FF00",
            lineWidth: 5,
          });
          drawLandmarks(canvasCtx, landmarks, {
            color: "#FF0000",
            lineWidth: 2,
          });
        } catch (e) {
          // ignore drawing errors
        }
      }
    }

    // process gestures
    if (results?.gestures && results.gestures.length > 0 && results.gestures[0].length > 0) {
      const best = results.gestures[0][0];
      const name = best?.categoryName || "";
      const score = typeof best?.score === "number" ? best.score : 0;

      if (name) {
        setDetectedData((prev) => [...prev, { SignDetected: name }]);
        setGestureOutput(name);
        setProgress(Math.round(score * 100));
      } else {
        setGestureOutput("");
        setProgress(0);
      }
    } else {
      setGestureOutput("");
      setProgress(0);
    }

    // continue loop
    if (webcamRunning) {
      requestRef.current = requestAnimationFrame(predictWebcam);
    }
  }, [runningMode, webcamRunning]);

  // animation wrapper (safe start)
  const animate = useCallback(() => {
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    requestRef.current = requestAnimationFrame(predictWebcam);
  }, [predictWebcam]);

  // Start/Stop camera & finalize data on stop
  const enableCam = useCallback(() => {
    if (!gestureRecognizerRef.current) {
      alert("Please wait for the model to load");
      return;
    }

    if (webcamRunning) {
      // STOP
      setWebcamRunning(false);
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
      setCurrentImage(null);

      const endTime = new Date();
      const timeElapsed = ((endTime.getTime() - startTime.getTime()) / 1000).toFixed(2);

      // filter meaningful detections
      const nonEmptyData = detectedData.filter((d) => d && d.SignDetected);

      if (nonEmptyData.length === 0) {
        setDetectedData([]);
        setGestureOutput("");
        setProgress(0);
        return;
      }

      // compress consecutive duplicates
      const resultArray = [];
      let current = nonEmptyData[0];
      for (let i = 1; i < nonEmptyData.length; i++) {
        if (nonEmptyData[i].SignDetected !== current.SignDetected) {
          resultArray.push(current);
          current = nonEmptyData[i];
        }
      }
      resultArray.push(current);

      // count each sign
      const countMap = new Map();
      for (const item of resultArray) {
        countMap.set(item.SignDetected, (countMap.get(item.SignDetected) || 0) + 1);
      }

      const outputArray = Array.from(countMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([sign, count]) => ({ SignDetected: sign, count }));

      const payload = {
        signsPerformed: outputArray,
        id: uuidv4(),
        username: user?.name,
        userId: user?.userId,
        createdAt: String(endTime),
        secondsSpent: Number(timeElapsed),
      };

      dispatch(addSignData(payload));
      setDetectedData([]);
      setGestureOutput("");
      setProgress(0);
    } else {
      // START
      setWebcamRunning(true);
      startTime = new Date();
      // start the loop
      requestRef.current = requestAnimationFrame(predictWebcam);
    }
  }, [webcamRunning, detectedData, dispatch, user, predictWebcam]);

  // Load the Mediapipe model once
  useEffect(() => {
    let mounted = true;
    let localRecognizer = null;

    async function loadGestureRecognizer() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );

        // IMPORTANT: use public path served from the `public/` folder
        // Ensure file exists at public/models/sign_language_recognizer_25-04-2023.task
        const modelPath = "/models/sign_language_recognizer_25-04-2023.task";

        const recognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: modelPath,
          },
          numHands: 2,
          runningMode: "IMAGE", // initial
        });

        if (!mounted) {
          try {
            if (recognizer?.close) recognizer.close();
          } catch (e) {}
          return;
        }

        localRecognizer = recognizer;
        gestureRecognizerRef.current = recognizer;
        setGestureRecognizer(recognizer);
      } catch (err) {
        console.error("Failed to load gesture recognizer:", err);
        alert(
          "Failed to load gesture model. Make sure the .task file is at public/models/sign_language_recognizer_25-04-2023.task"
        );
      }
    }

    loadGestureRecognizer();

    return () => {
      mounted = false;
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
      try {
        if (localRecognizer && localRecognizer.close) localRecognizer.close();
      } catch (e) {}
    };
  }, []); // load once

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      try {
        if (gestureRecognizerRef.current && gestureRecognizerRef.current.close) {
          gestureRecognizerRef.current.close();
        }
      } catch (e) {}
    };
  }, []);

  return (
    <div className="signlang_detection-container">
      {accessToken ? (
        <>
          <div style={{ position: "relative" }}>
            <Webcam audio={false} ref={webcamRef} className="signlang_webcam" />
            <canvas ref={canvasRef} className="signlang_canvas" />

            <div className="signlang_data-container">
              <button onClick={enableCam}>
                {webcamRunning ? "Stop" : "Start"}
              </button>

              <div className="signlang_data">
                <p className="gesture_output">{gestureOutput}</p>
                {progress ? <ProgressBar progress={progress} /> : null}
              </div>
            </div>
          </div>

          <div className="signlang_imagelist-container">
            <h2 className="gradient__text">Image</h2>
            <div className="signlang_image-div">
              {currentImage ? (
                <img src={currentImage.url} alt={`img ${currentImage.id}`} />
              ) : (
                <h3 className="gradient__text">
                  Click on the Start Button <br /> to practice with Images
                </h3>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="signlang_detection_notLoggedIn">
          <h1 className="gradient__text">Please Login !</h1>
          <img src={DisplayImg} alt="display-img" />
          <p>
            We save your detection data to show your progress and learning in the
            dashboard. So please log in to test this detection feature.
          </p>
        </div>
      )}
    </div>
  );
};

export default Detect;
