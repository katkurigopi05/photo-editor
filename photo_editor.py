import tkinter as tk
from tkinter import filedialog, messagebox
from PIL import Image, ImageTk, ImageFilter, ImageEnhance, ImageOps
import os

class SimpleImageEditor:
    """
    Core class handling all image processing logic using PIL.
    Manages the image state and applies filters non-destructively 
    by utilizing an undo history stack.
    """
    def __init__(self):
        self.image_states = []
        self.current_state_index = -1 
        self.current_pil_image = None

    def load_image(self, path):
        try:
            self.current_pil_image = Image.open(path).convert("RGB")
            self.image_states = [self.current_pil_image.copy()]
            self.current_state_index = 0
            return True
        except Exception as e:
            messagebox.showerror("Error", f"Could not load image: {e}")
            return False

    def _save_current_state(self):
        if self.current_pil_image:
            new_state = self.current_pil_image.copy()
            # If we're not at the end of the history (i.e. we undid some steps and now making a new change)
            # we should truncate the future history
            if self.current_state_index < len(self.image_states) - 1:
                self.image_states = self.image_states[:self.current_state_index + 1]
            
            self.image_states.append(new_state)
            self.current_state_index += 1
            
            # Limit history to prevent excessive memory usage (e.g. 10 states)
            if len(self.image_states) > 10:
                self.image_states.pop(0)
                self.current_state_index -= 1

    def undo(self):
        if self.current_state_index > 0:
            self.current_state_index -= 1
            self.current_pil_image = self.image_states[self.current_state_index].copy()
            return True
        return False

    def apply_filter(self, filter_type, **kwargs):
        if not self.current_pil_image:
            return False

        new_image = self.current_pil_image.copy()

        try:
            if filter_type == "Grayscale":
                new_image = ImageOps.grayscale(new_image).convert("RGB")
            elif filter_type == "Sepia":
                # Fast matrix conversion for Sepia
                sepia_matrix = (
                    0.393, 0.769, 0.189, 0,
                    0.349, 0.686, 0.168, 0,
                    0.272, 0.534, 0.131, 0
                )
                new_image = new_image.convert("RGB", sepia_matrix)
            elif filter_type == "Blur":
                radius = kwargs.get('radius', 3)
                new_image = new_image.filter(ImageFilter.GaussianBlur(radius))
            elif filter_type == "Rotate":
                # Rotate 90 degrees left
                new_image = new_image.rotate(90, expand=True)
            elif filter_type == "Flip Horizontal":
                new_image = ImageOps.mirror(new_image)
            elif filter_type == "Flip Vertical":
                new_image = ImageOps.flip(new_image)
            elif filter_type == "Brightness Up":
                enhancer = ImageEnhance.Brightness(new_image)
                new_image = enhancer.enhance(1.2)
            elif filter_type == "Brightness Down":
                enhancer = ImageEnhance.Brightness(new_image)
                new_image = enhancer.enhance(0.8)
            else:
                return False

            self.current_pil_image = new_image
            self._save_current_state()
            return True

        except Exception as e:
            messagebox.showerror("Processing Error", f"Filter application failed: {e}")
            return False

    def resize_image(self, width, height):
        if self.current_pil_image:
            new_image = self.current_pil_image.copy()
            try:
                new_image = new_image.resize((width, height))
                self.current_pil_image = new_image
                self._save_current_state()
            except Exception as e:
                messagebox.showerror("Resize Error", f"Resizing failed: {e}")
        return True

    def save_image(self, path):
        if self.current_pil_image:
            try:
                file_ext = os.path.splitext(path)[1].lower()
                if file_ext == '.png':
                    self.current_pil_image.save(path, format='PNG')
                else:
                    self.current_pil_image.save(path, format='JPEG')
                return True
            except Exception as e:
                messagebox.showerror("Save Error", f"Failed to save image: {e}")
                return False
        return False

# =============================
# --- GUI Implementation using Tkinter ---
# =============================

class AppGUI:
    def __init__(self, master):
        self.master = master
        master.title("Advanced Photo Editor")

        self.editor = SimpleImageEditor()
        
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

        # Toolbar for filters
        self.filter_frame = tk.Frame(master, padx=10, pady=5)
        self.filter_frame.pack(fill="x")
        
        tk.Label(self.filter_frame, text="Filters:").pack(side=tk.LEFT, padx=5)
        tk.Button(self.filter_frame, text="Grayscale", command=lambda: self.apply_and_refresh("Grayscale")).pack(side=tk.LEFT, padx=5)
        tk.Button(self.filter_frame, text="Sepia", command=lambda: self.apply_and_refresh("Sepia")).pack(side=tk.LEFT, padx=5)
        tk.Button(self.filter_frame, text="Blur", command=lambda: self.apply_and_refresh("Blur")).pack(side=tk.LEFT, padx=5)

        # Toolbar for adjustments
        self.adj_frame = tk.Frame(master, padx=10, pady=5)
        self.adj_frame.pack(fill="x")
        
        tk.Label(self.adj_frame, text="Adjustments:").pack(side=tk.LEFT, padx=5)
        tk.Button(self.adj_frame, text="Rotate 90°", command=lambda: self.apply_and_refresh("Rotate")).pack(side=tk.LEFT, padx=5)
        tk.Button(self.adj_frame, text="Flip Horiz", command=lambda: self.apply_and_refresh("Flip Horizontal")).pack(side=tk.LEFT, padx=5)
        tk.Button(self.adj_frame, text="Flip Vert", command=lambda: self.apply_and_refresh("Flip Vertical")).pack(side=tk.LEFT, padx=5)
        tk.Button(self.adj_frame, text="Brighten (+)", command=lambda: self.apply_and_refresh("Brightness Up")).pack(side=tk.LEFT, padx=5)
        tk.Button(self.adj_frame, text="Darken (-)", command=lambda: self.apply_and_refresh("Brightness Down")).pack(side=tk.LEFT, padx=5)
        tk.Button(self.adj_frame, text="Resize (800x600)", command=lambda: self.apply_and_refresh("Resize")).pack(side=tk.LEFT, padx=5)

    def display_image(self):
        if not self.editor.current_pil_image:
            return

        width, height = self.editor.current_pil_image.size
        # Dynamically size to the label if possible, or use a fixed max
        max_display_width = 800
        max_display_height = 600

        display_img = self.editor.current_pil_image.copy()
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
            if self.editor.load_image(path):
                self.display_image()

    def save_action(self):
        path = filedialog.asksaveasfilename(
            defaultextension=".png",
            title="Save Edited Image As",
            filetypes=[("PNG files", "*.png"), ("JPEG files", "*.jpg")]
        )
        if path:
            self.editor.save_image(path)

    def undo_action(self):
        if self.editor.undo():
            self.display_image()
        else:
            messagebox.showinfo("Undo", "Nothing more to undo.")

    def apply_and_refresh(self, action):
        success = False
        if action == "Resize":
            success = self.editor.resize_image(800, 600)
        else:
            success = self.editor.apply_filter(action)
        
        if success:
            self.display_image()

if __name__ == "__main__":
    root = tk.Tk()
    root.geometry("900x850") 
    app = AppGUI(root)
    root.protocol("WM_DELETE_WINDOW", root.quit) 
    root.mainloop()
