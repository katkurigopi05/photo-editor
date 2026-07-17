"""Filesystem plugin loader (see PRO_DEVELOPMENT.md, Phase 4).

A plugin is a .py file in the plugins/ directory that defines Operation
subclasses decorated with core.operations.register. Loading a plugin simply
executes the module; the decorator adds its operations to the shared
registry, and load_plugins reports which names each scan added so a GUI can
build controls for them.
"""
import importlib.util
import os

from .operations import registered_operations

DEFAULT_PLUGIN_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "plugins")


def load_plugins(directory: str = DEFAULT_PLUGIN_DIR) -> list[str]:
    """Execute every plugin module in `directory`; return newly registered
    operation names. A broken plugin is skipped, not fatal — its error is
    reported via the returned errors list on the function attribute
    load_plugins.errors for the caller to surface if it wants."""
    load_plugins.errors = []
    if not os.path.isdir(directory):
        return []

    before = set(registered_operations())
    for filename in sorted(os.listdir(directory)):
        if filename.startswith("_") or not filename.endswith(".py"):
            continue
        path = os.path.join(directory, filename)
        module_name = f"photo_editor_plugin_{filename[:-3]}"
        try:
            spec = importlib.util.spec_from_file_location(module_name, path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
        except Exception as e:
            load_plugins.errors.append(f"{filename}: {e}")

    return [name for name in registered_operations() if name not in before]
