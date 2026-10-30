import { Controller, Get, Post, Body, Param, HttpStatus, HttpCode, Req } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { getClientContext } from '../meta/tracking.utils';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  async createUser(@Body() createUserDto: CreateUserDto, @Req() req: any) {
    const { user, created } = await this.usersService.createOrGetUser(
      createUserDto,
      getClientContext(req),
    );
    return {
      statusCode: created ? HttpStatus.CREATED : HttpStatus.OK,
      message: created ? 'User created successfully' : 'User already exists',
      data: user,
    };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAllUsers() {
    const users = await this.usersService.findAllUsers();
    return {
      message: 'Users retrieved successfully',
      data: users,
    };
  }

  @Get(':userId')
  @HttpCode(HttpStatus.OK)
  async findUserById(@Param('userId') userId: string, @Req() req: any) {
    const user = await this.usersService.getUserFromRequest(req);
    return {
      message: 'User retrieved successfully',
      data: user,
    };
  }

  @Get('supabase/:supabaseId')
  @HttpCode(HttpStatus.OK)
  async findUserBySupabaseId(@Param('supabaseId') supabaseId: string, @Req() req: any) {
    const user = await this.usersService.getUserFromRequest(req);
    return {
      message: 'User retrieved successfully',
      data: user,
    };
  }
}
