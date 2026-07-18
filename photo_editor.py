import threading
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog
from PIL import ImageTk

from core import (
    Document,
    Grayscale,
    Sepia,
    GaussianBlur,
    Rotate90,
    FlipHorizontal,
    FlipVertical,
    Brightness,
    Resize,
    Contrast,
    Highlights,
    Shadows,
    Levels,
    AutoContrast,
    Equalize,
    Saturation,
    Vibrance,
    Temperature,
    Tint,
    AutoWhiteBalance,
    Sharpen,
    Posterize,
    Solarize,
    Vignette,
    Rotate,
    load_plugins,
    registered_operations,
)
from ai_tools import AutoCrop, RemoveBackground
from cv_tools import BilateralFilter, CLAHE, Denoise, UnsharpMask

OPEN_FILETYPES = [
    ("Image Files", "*.jpg *.jpeg *.png *.bmp *.webp"),
    ("RAW Files", "*.cr2 *.cr3 *.nef *.arw *.dng *.raf *.orf *.rw2"),
]

# =============================
# --- GUI Implementation using Tkinter ---
# =============================

class AppGUI:
    def __init__(self, master):
        self.master = master
        master.title("Advanced Photo Editor")

        self.document = None
        self._buttons = []

        self.main_frame = tk.Frame(master, padx=10, pady=10)
        self.main_frame.pack(fill="both", expand=True)

        self.image_label = tk.Label(self.main_frame, bg="grey", text="Open an image to start editing", width=100, height=30)
        self.image_label.pack(pady=10, padx=10, fill="both", expand=True)

        self.status_var = tk.StringVar(value="Ready")
        tk.Label(master, textvariable=self.status_var, anchor="w", padx=10).pack(fill="x", side=tk.BOTTOM)

        # Toolbar for file operations
        file_frame = self._toolbar_row()
        self._button(file_frame, "📂 Open Image", self.select_file)
        self._button(file_frame, "💾 Save Image", self.save_action)
        self._button(file_frame, "📋 Save Recipe", self.save_recipe_action)
        self._button(file_frame, "📥 Load Recipe", self.load_recipe_action)
        self._button(file_frame, "↩ Undo", self.undo_action)
        self._button(file_frame, "↪ Redo", self.redo_action)

        # Toolbar for filters
        filter_frame = self._toolbar_row("Filters:")
        self._op_button(filter_frame, "Grayscale", Grayscale)
        self._op_button(filter_frame, "Sepia", Sepia)
        self._op_button(filter_frame, "Blur", lambda: GaussianBlur(radius=3))

        # Toolbar for light/tone adjustments
        light_frame = self._toolbar_row("Light:")
        self._op_button(light_frame, "Brighten (+)", lambda: Brightness(factor=1.2))
        self._op_button(light_frame, "Darken (-)", lambda: Brightness(factor=0.8))
        self._slider_button(light_frame, "Contrast", lambda v: Contrast(v), 1.3, "Contrast factor (1.0 = none)")
        self._slider_button(light_frame, "Highlights", lambda v: Highlights(v), -50, "Highlights (-100..100)")
        self._slider_button(light_frame, "Shadows", lambda v: Shadows(v), 50, "Shadows (-100..100)")
        self._slider_button(light_frame, "Levels γ", lambda v: Levels(0, 255, v), 1.2, "Gamma (>0, 1.0 = none)")
        self._op_button(light_frame, "Auto Contrast", AutoContrast)
        self._op_button(light_frame, "Equalize", Equalize)

        # Toolbar for color adjustments
        color_frame = self._toolbar_row("Color:")
        self._slider_button(color_frame, "Saturation", lambda v: Saturation(v), 1.4, "Saturation factor (1.0 = none)")
        self._slider_button(color_frame, "Vibrance", lambda v: Vibrance(v), 40, "Vibrance (-100..100)")
        self._slider_button(color_frame, "Temperature", lambda v: Temperature(v), 30, "Temperature (-100 cool..100 warm)")
        self._slider_button(color_frame, "Tint", lambda v: Tint(v), 0, "Tint (-100 green..100 magenta)")
        self._op_button(color_frame, "Auto WB", AutoWhiteBalance)

        # Toolbar for detail, effects and geometry
        fx_frame = self._toolbar_row("Detail/FX:")
        self._slider_button(fx_frame, "Sharpen", lambda v: Sharpen(v), 2.0, "Sharpness factor (1.0 = none)")
        self._slider_button(fx_frame, "Posterize", lambda v: Posterize(int(v)), 3, "Bits (1..8)")
        self._slider_button(fx_frame, "Solarize", lambda v: Solarize(int(v)), 128, "Threshold (0..255)")
        self._slider_button(fx_frame, "Vignette", lambda v: Vignette(v), 40, "Strength (0..100)")

        # Toolbar for geometry
        geo_frame = self._toolbar_row("Geometry:")
        self._op_button(geo_frame, "Rotate 90°", Rotate90)
        self._slider_button(geo_frame, "Straighten", lambda v: Rotate(v), 0, "Angle in degrees")
        self._op_button(geo_frame, "Flip Horiz", FlipHorizontal)
        self._op_button(geo_frame, "Flip Vert", FlipVertical)
        self._op_button(geo_frame, "Resize (800x600)", lambda: Resize(width=800, height=600))

        # Toolbar for OpenCV tools (needs requirements-cv.txt; a clear install
        # hint is shown on first use if it isn't installed)
        cv_frame = self._toolbar_row("OpenCV:")
        self._op_button(cv_frame, "CLAHE", CLAHE)
        self._op_button(cv_frame, "Denoise", Denoise)
        self._op_button(cv_frame, "Bilateral", BilateralFilter)
        self._slider_button(cv_frame, "Unsharp", lambda v: UnsharpMask(amount=v), 1.0, "Amount (e.g. 1.0)")

        # Toolbar for AI tools (heavy deps load on first use; a clear install
        # hint is shown if requirements-ai.txt isn't installed)
        ai_frame = self._toolbar_row("AI:")
        self._op_button(ai_frame, "Remove Background", RemoveBackground)
        self._op_button(ai_frame, "Auto Crop", AutoCrop)

        # Toolbar for plugins, built dynamically from the plugins/ directory
        plugin_names = load_plugins()
        if plugin_names:
            plugin_frame = self._toolbar_row("Plugins:")
            registry = registered_operations()
            for name in plugin_names:
                cls = registry[name]
                try:
                    cls()  # only zero-arg-constructible ops get a button
                except TypeError:
                    continue
                self._op_button(plugin_frame, cls.label, cls)
        for error in getattr(load_plugins, "errors", []):
            messagebox.showwarning("Plugin Error", f"Skipped broken plugin — {error}")

    # --- toolbar helpers ---------------------------------------------------

    def _toolbar_row(self, label=None):
        frame = tk.Frame(self.master, padx=10, pady=5)
        frame.pack(fill="x")
        if label:
            tk.Label(frame, text=label).pack(side=tk.LEFT, padx=5)
        return frame

    def _button(self, frame, text, command):
        button = tk.Button(frame, text=text, command=command)
        button.pack(side=tk.LEFT, padx=5)
        self._buttons.append(button)
        return button

    def _op_button(self, frame, text, op_factory):
        self._button(frame, text, lambda: self.apply_and_refresh(op_factory()))

    def _slider_button(self, frame, text, op_factory, default, prompt):
        """Button for a parametric op: asks for a value, then applies
        op_factory(value). Keeps the GUI simple without per-op dialogs."""
        def run():
            if not self.document:
                return
            value = simpledialog.askfloat(text, prompt, initialvalue=default, parent=self.master)
            if value is None:
                return  # cancelled
            try:
                operation = op_factory(value)
            except ValueError as e:
                messagebox.showerror(text, str(e))
                return
            self.apply_and_refresh(operation)
        self._button(frame, text, run)

    def _set_busy(self, busy, message="Processing…"):
        self.status_var.set(message if busy else "Ready")
        state = tk.DISABLED if busy else tk.NORMAL
        for button in self._buttons:
            button.config(state=state)

    # --- rendering ---------------------------------------------------------

    def display_image(self):
        if not self.document:
            return

        display_img = self.document.render().copy()
        display_img.thumbnail((800, 600))

        tk_img = ImageTk.PhotoImage(display_img)
        self.image_label.config(image=tk_img, text="", width=display_img.width, height=display_img.height)
        self.image_label.image = tk_img

    def apply_and_refresh(self, operation):
        if not self.document:
            return
        self.document.add_operation(operation)
        self._render_async(rollback_on_error=True)

    def _render_async(self, rollback_on_error=False):
        """Render on a worker thread so slow filters (AI ops especially)
        don't freeze the Tkinter mainloop."""
        self._set_busy(True)
        document = self.document

        def work():
            try:
                document.render()
                error = None
            except Exception as e:
                error = e
            self.master.after(0, lambda: self._render_done(error, rollback_on_error))

        threading.Thread(target=work, daemon=True).start()

    def _render_done(self, error, rollback_on_error):
        self._set_busy(False)
        if error:
            if rollback_on_error:
                self.document.remove_last_operation()
            messagebox.showerror("Processing Error", f"Filter application failed: {error}")
            return
        self.display_image()

    # --- actions -----------------------------------------------------------

    def select_file(self):
        path = filedialog.askopenfilename(title="Select an Image File", filetypes=OPEN_FILETYPES)
        if path:
            try:
                self.document = Document.open(path)
            except Exception as e:
                messagebox.showerror("Error", f"Could not load image: {e}")
                return
            self.display_image()

    def save_action(self):
        if not self.document:
            return
        path = filedialog.asksaveasfilename(
            defaultextension=".png",
            title="Save Edited Image As",
            filetypes=[("PNG files", "*.png"), ("JPEG files", "*.jpg")]
        )
        if path:
            try:
                self.document.export(path)
            except Exception as e:
                messagebox.showerror("Save Error", f"Failed to save image: {e}")

    def save_recipe_action(self):
        if not self.document:
            return
        path = filedialog.asksaveasfilename(
            defaultextension=".json",
            title="Save Edit Recipe As",
            filetypes=[("Recipe files", "*.json")]
        )
        if path:
            try:
                self.document.save_recipe(path)
            except Exception as e:
                messagebox.showerror("Save Error", f"Failed to save recipe: {e}")

    def load_recipe_action(self):
        path = filedialog.askopenfilename(title="Load Edit Recipe", filetypes=[("Recipe files", "*.json")])
        if path:
            try:
                self.document = Document.load_recipe(path)
            except Exception as e:
                messagebox.showerror("Error", f"Could not load recipe: {e}")
                return
            self._render_async()

    def undo_action(self):
        if self.document and self.document.undo():
            self.display_image()
        else:
            messagebox.showinfo("Undo", "Nothing more to undo.")

    def redo_action(self):
        if self.document and self.document.redo():
            self._render_async()
        else:
            messagebox.showinfo("Redo", "Nothing to redo.")

if __name__ == "__main__":
    root = tk.Tk()
    root.geometry("900x850")
    app = AppGUI(root)
    root.protocol("WM_DELETE_WINDOW", root.quit)
    root.mainloop()
