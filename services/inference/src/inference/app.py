from fastapi import FastAPI

from inference.routers import image, llm, upscale, video

app = FastAPI(title="kelvoy-inference")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(llm.router, prefix="/llm")
app.include_router(image.router, prefix="/image")
app.include_router(video.router, prefix="/video")
app.include_router(upscale.router, prefix="/upscale")
