```markdown
# photo-editor Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill covers the core development patterns and conventions used in the `photo-editor` Python codebase. You'll learn how to structure files, write imports and exports, follow commit and testing conventions, and execute common workflows for contributing to and maintaining the project.

## Coding Conventions

### File Naming
- Use **snake_case** for all file names.
  - Example: `image_filters.py`, `photo_utils.py`

### Import Style
- Use **relative imports** within the package.
  - Example:
    ```python
    from .image_filters import apply_blur
    ```

### Export Style
- Use **named exports** (explicitly define what is exported).
  - Example:
    ```python
    __all__ = ['apply_blur', 'resize_image']
    ```

### Commit Messages
- No strict prefix required; freeform messages are used.
- Average commit message length: ~49 characters.
  - Example:  
    ```
    Add sepia filter and update README with usage
    ```

## Workflows

### Adding a New Feature
**Trigger:** When you want to introduce new functionality.
**Command:** `/add-feature`

1. Create a new Python file using snake_case if needed.
2. Implement the feature using relative imports for any internal modules.
3. Add named exports to the file.
4. Write or update tests in a corresponding `*.test.*` file.
5. Commit your changes with a clear, descriptive message.

### Fixing a Bug
**Trigger:** When you need to resolve a defect or issue.
**Command:** `/fix-bug`

1. Locate the relevant module using snake_case naming.
2. Apply the fix, using relative imports as needed.
3. Update or add tests to cover the bug scenario.
4. Commit with a concise message describing the fix.

### Running Tests
**Trigger:** To verify code correctness after changes.
**Command:** `/run-tests`

1. Identify test files matching the `*.test.*` pattern.
2. Run tests using the project's preferred method (framework is unknown; check project docs or use `python <test_file>`).
3. Review output and address any failures.

## Testing Patterns

- Test files follow the `*.test.*` naming pattern (e.g., `image_filters.test.py`).
- The testing framework is not specified; check for test runners or use standard Python test execution.
- Tests should cover new features and bug fixes.

## Commands
| Command      | Purpose                                   |
|--------------|-------------------------------------------|
| /add-feature | Steps to add a new feature                |
| /fix-bug     | Steps to fix a bug                        |
| /run-tests   | Steps to run the test suite               |
```