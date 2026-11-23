# Code

Inline `const x = 1` code.

```js
// JavaScript
const greet = (name) => `Hello, ${name}!`;
class Wind extends Breeze { static speed = 42; }
export default { greet, re: /miami\s+wind/gi, n: null, t: true };
console.log(greet.name, Wind.speed);
```

```ts
interface Palette { pink: string; cyan?: number }
type Mode = "dark" | "light";
function pick<T extends Palette>(p: T): Mode { return "dark"; }
```

```python
import math
@decorator
def area(r: float) -> float:
    """Docstring."""
    return math.pi * r ** 2  # comment
print(f"{area(2):.2f}", None, True)
```

```rust
#[derive(Debug)]
struct Point { x: i32, y: i32 }
fn main() { let p = Point { x: 1, y: 2 }; println!("{:?}", p); }
```

```go
package main
import "fmt"
func main() { ch := make(chan int); go func() { ch <- 1 }(); fmt.Println(<-ch) }
```

```bash
#!/usr/bin/env bash
for f in *.md; do echo "$f" | grep -q "x" && rm -- "$f"; done
export PATH="$HOME/bin:$PATH"
```

```json
{ "name": "Miami Wind", "version": "1.2.2", "dark": true, "n": 3, "list": [1, null] }
```

```yaml
name: Miami Wind
colors: [pink, cyan]
dark: true # comment
```

```css
.theme-dark { --accent: #ff2e88; }
a:hover::after { content: "→"; color: rgb(31 209 249 / 50%); }
```

```html
<!doctype html>
<div class="note" data-x="1"><a href="#">link</a><!-- comment --></div>
```

```sql
SELECT id, name FROM notes WHERE tag = 'theme' ORDER BY created DESC LIMIT 10;
```

```diff
- removed line
+ added line
  unchanged line
```

```java
public class Main { public static void main(String[] args) { System.out.println("hi"); } }
```

```c
#include <stdio.h>
int main(void) { printf("%d\n", 42); return 0; }
```

```cpp
template <typename T> T max(T a, T b) { return a > b ? a : b; }
```

```csharp
public record Point(int X, int Y);
var p = new Point(1, 2);
```

```ruby
def hello(name) = puts "Hello, #{name}"
```

```php
<?php echo "Hello " . $name; ?>
```

```lua
local t = { 1, 2, 3 } for i, v in ipairs(t) do print(i, v) end
```

```swift
let colors = ["pink", "cyan"]; colors.forEach { print($0) }
```

```kotlin
data class User(val name: String); fun main() = println(User("Mike"))
```

```toml
[theme]
name = "Miami Wind"
dark = true
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE note SYSTEM "note.dtd">
<x:note xmlns:x="urn:sample" lang="en">&amp; text <![CDATA[ raw <data> ]]></x:note>
```

```c
char c = 'a'; /* char literal */
```

```css
.bg { background: url("image.png"); }
```

```ruby
status = :active
```

```markdown
# Markdown in code
- **bold** item and *italic* text
```

```
Plain code block with no language.
```

    Indented code block.

~~~
Tilde fenced block.
~~~
