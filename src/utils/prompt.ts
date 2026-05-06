import inquirer from 'inquirer'

export async function confirm(message: string, defaultYes = true): Promise<boolean> {
  const { value } = await inquirer.prompt<{ value: boolean }>([
    {
      type: 'confirm',
      name: 'value',
      message,
      default: defaultYes,
    },
  ])

  return value
}

export async function input(message: string, defaultValue?: string): Promise<string> {
  const { value } = await inquirer.prompt<{ value: string }>([
    {
      type: 'input',
      name: 'value',
      message,
      default: defaultValue,
    },
  ])

  return value
}

export async function select<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T }>
): Promise<T> {
  const { value } = await inquirer.prompt<{ value: T }>([
    {
      type: 'list',
      name: 'value',
      message,
      choices,
    },
  ])

  return value
}

export async function pause(message = 'Press Enter to continue'): Promise<void> {
  await inquirer.prompt([
    {
      type: 'input',
      name: 'value',
      message,
    },
  ])
}
