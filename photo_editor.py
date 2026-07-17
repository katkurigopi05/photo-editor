import tkinter as tk
from tkinter import filedialog, messagebox
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
)

# =============================
# --- GUI Implementation using Tkinter ---
# =============================

class AppGUI:
    def __init__(self, master):
        self.master = master
        master.title("Advanced Photo Editor")

        self.document = None

        self.main_frame = tk.Frame(master, padx=10, pady=10)
        self.main_frame.pack(fill="both", expand=True)

        self.image_label = tk.Label(self.main_frame, bg="grey", text="Open an image to start editing", width=100, height=30)
        self.image_label.pack(pady=10, padx=10, fill="both", expand=True)

        # Toolbar for file operations
        self.file_frame = tk.Frame(master, padx=10, pady=5)
        self.file_frame.pack(fill="x")

        tk.Button(self.file_frame, text="📂 Open Image", command=self.select_file).pack(side=tk.LEFT, padx=5)
        tk.Button(self.file_frame, text="💾 Save Image", command=self.save_action).pack(side=tk.LEFT, padx=5)
        tk.Button(self.file_frame, text="↩ Undo", command=self.undo_action).pack(side=tk.LEFT, padx=5)
        tk.Button(self.file_frame, text="↪ Redo", command=self.redo_action).pack(side=tk.LEFT, padx=5)

        # Toolbar for filters
        self.filter_frame = tk.Frame(master, padx=10, pady=5)
        self.filter_frame.pack(fill="x")

        tk.Label(self.filter_frame, text="Filters:").pack(side=tk.LEFT, padx=5)
        tk.Button(self.filter_frame, text="Grayscale", command=lambda: self.apply_and_refresh(Grayscale())).pack(side=tk.LEFT, padx=5)
        tk.Button(self.filter_frame, text="Sepia", command=lambda: self.apply_and_refresh(Sepia())).pack(side=tk.LEFT, padx=5)
        tk.Button(self.filter_frame, text="Blur", command=lambda: self.apply_and_refresh(GaussianBlur(radius=3))).pack(side=tk.LEFT, padx=5)

        # Toolbar for adjustments
        self.adj_frame = tk.Frame(master, padx=10, pady=5)
        self.adj_frame.pack(fill="x")

        tk.Label(self.adj_frame, text="Adjustments:").pack(side=tk.LEFT, padx=5)
        tk.Button(self.adj_frame, text="Rotate 90°", command=lambda: self.apply_and_refresh(Rotate90())).pack(side=tk.LEFT, padx=5)
        tk.Button(self.adj_frame, text="Flip Horiz", command=lambda: self.apply_and_refresh(FlipHorizontal())).pack(side=tk.LEFT, padx=5)
        tk.Button(self.adj_frame, text="Flip Vert", command=lambda: self.apply_and_refresh(FlipVertical())).pack(side=tk.LEFT, padx=5)
        tk.Button(self.adj_frame, text="Brighten (+)", command=lambda: self.apply_and_refresh(Brightness(factor=1.2))).pack(side=tk.LEFT, padx=5)
        tk.Button(self.adj_frame, text="Darken (-)", command=lambda: self.apply_and_refresh(Brightness(factor=0.8))).pack(side=tk.LEFT, padx=5)
        tk.Button(self.adj_frame, text="Resize (800x600)", command=lambda: self.apply_and_refresh(Resize(width=800, height=600))).pack(side=tk.LEFT, padx=5)

    def display_image(self):
        if not self.document:
            return

        max_display_width = 800
        max_display_height = 600

        display_img = self.document.render().copy()
        display_img.thumbnail((max_display_width, max_display_height))

        tk_img = ImageTk.PhotoImage(display_img)
        self.image_label.config(image=tk_img, text="", width=display_img.width, height=display_img.height)
        self.image_label.image = tk_img

    def select_file(self):
        path = filedialog.askopenfilename(
            title="Select an Image File",
            filetypes=[("Image Files", "*.jpg *.jpeg *.png *.bmp *.webp")]
        )
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

    def undo_action(self):
        if self.document and self.document.undo():
            self.display_image()
        else:
            messagebox.showinfo("Undo", "Nothing more to undo.")

    def redo_action(self):
        if self.document and self.document.redo():
            self.display_image()
        else:
            messagebox.showinfo("Redo", "Nothing to redo.")

    def apply_and_refresh(self, operation):
        if not self.document:
            return
        try:
            self.document.add_operation(operation)
            self.document.render()
        except Exception as e:
            self.document.undo()
            messagebox.showerror("Processing Error", f"Filter application failed: {e}")
            return
        self.display_image()

if __name__ == "__main__":
    root = tk.Tk()
    root.geometry("900x850")
    app = AppGUI(root)
    root.protocol("WM_DELETE_WINDOW", root.quit)
    root.mainloop()
