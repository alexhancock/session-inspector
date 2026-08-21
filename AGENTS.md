# Session Inspector AGENTS.md
 
## Coding preferences
- Use the minimum possible code for each task
- Make modules "deep" in that they will have a lot of functionality for a given
  area of the program compared to the size of their interface. Follow the philosophy
  that interface === cost and functionality === benefit when making each module
- Do not add code comments at all, as most code should be self explanatory
- Only add minimal tests and when they are truly needed to verify behavior
  that could break stays working. The value of a test is the number of bugs
  it catches divided by the times you need to modify it. So add tests only
  when they really make sense to make sure something keeps working
 
## Testing instructions
- Add unit tests that are truly needed using a lightweight option in the files
  themselves. Make them runnable via npm run test
